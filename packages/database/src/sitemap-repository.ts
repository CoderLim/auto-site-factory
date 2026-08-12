import type {
  SitemapReconcileResult,
  SitemapStateStore,
  SitemapUrlEntry,
  SourceTarget
} from "@factory/shared"
import type { Database } from "./client.js"

export interface SitemapTargetSummary {
  id: string
  name: string
  scope: string
  enabled: boolean
  config: Record<string, unknown>
  totalUrlCount: number
  activeUrlCount: number
  lastSuccessAt?: string
  lastAttemptAt?: string
}

export interface SitemapSignalRow {
  id: string
  targetId: string
  targetName: string
  url?: string
  title?: string
  keyword?: string
  pageTitle?: string
  h1?: string
  discoveredAt: string
}

export interface SitemapRunRow {
  runId: string
  targetId: string
  targetName: string
  status: string
  signalCount: number
  error?: string
  startedAt: string
  finishedAt?: string
}

export interface SitemapAnomaly {
  severity: "info" | "warning" | "critical"
  code: string
  targetId: string
  message: string
  recordedAt?: string
}

function toTarget(row: Record<string, unknown>): SourceTarget {
  return {
    id: String(row.id),
    sourceType: "sitemap",
    name: String(row.name),
    scope: String(row.scope),
    enabled: Boolean(row.enabled),
    config: (row.config ?? {}) as Record<string, unknown>
  }
}

export class SitemapRepository implements SitemapStateStore {
  constructor(private readonly db: Database) {}

  async reconcile(
    targetId: string,
    entries: SitemapUrlEntry[],
    seenAt: Date,
    baselineOnFirstRun: boolean,
    limit: number
  ): Promise<SitemapReconcileResult> {
    const existing = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM sitemap_urls WHERE source_target_id = $1`,
      [targetId]
    )
    const initialized = (existing.rows[0]?.count ?? 0) > 0
    const suppressNew = !initialized && baselineOnFirstRun
    const payload = entries.map((entry) => ({
      url: entry.url,
      keyword: entry.keyword ?? null
    }))

    if (payload.length > 0) {
      await this.db.query(
        `INSERT INTO sitemap_urls (
           source_target_id, url, keyword, first_seen_at, last_seen_at, signal_emitted_at, is_active
         )
         SELECT $1, item.url, item.keyword, $3, $3, CASE WHEN $4 THEN $3 ELSE NULL END, TRUE
         FROM jsonb_to_recordset($2::jsonb) AS item(url TEXT, keyword TEXT)
         ON CONFLICT (source_target_id, url) DO UPDATE SET
           keyword = COALESCE(EXCLUDED.keyword, sitemap_urls.keyword),
           last_seen_at = EXCLUDED.last_seen_at,
           is_active = TRUE`,
        [targetId, JSON.stringify(payload), seenAt, suppressNew]
      )
    }

    await this.db.query(
      `UPDATE sitemap_urls
       SET is_active = FALSE
       WHERE source_target_id = $1 AND last_seen_at < $2`,
      [targetId, seenAt]
    )

    const pendingCountResult = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM sitemap_urls
       WHERE source_target_id = $1 AND signal_emitted_at IS NULL AND is_active = TRUE`,
      [targetId]
    )
    const pending = await this.db.query<{ url: string }>(
      `SELECT url
       FROM sitemap_urls
       WHERE source_target_id = $1 AND signal_emitted_at IS NULL AND is_active = TRUE
       ORDER BY first_seen_at ASC, url ASC
       LIMIT $2`,
      [targetId, limit]
    )

    return {
      initialized,
      pendingUrls: pending.rows.map((row) => row.url),
      pendingCount: pendingCountResult.rows[0]?.count ?? 0
    }
  }

  async markEmitted(targetId: string, urls: string[], emittedAt: Date): Promise<void> {
    if (urls.length === 0) return
    await this.db.query(
      `UPDATE sitemap_urls
       SET signal_emitted_at = COALESCE(signal_emitted_at, $3)
       WHERE source_target_id = $1 AND url = ANY($2::text[])`,
      [targetId, urls, emittedAt]
    )
  }

  async updateMetadata(
    targetId: string,
    url: string,
    metadata: { pageTitle?: string; h1?: string }
  ): Promise<void> {
    if (!metadata.pageTitle && !metadata.h1) return
    await this.db.query(
      `UPDATE sitemap_urls
       SET page_title = COALESCE($3, page_title), h1 = COALESCE($4, h1)
       WHERE source_target_id = $1 AND url = $2`,
      [targetId, url, metadata.pageTitle ?? null, metadata.h1 ?? null]
    )
  }

  async listTargets(): Promise<SitemapTargetSummary[]> {
    const result = await this.db.query(
      `SELECT st.id, st.name, st.scope, st.enabled, st.config,
              COUNT(su.url)::int AS total_url_count,
              COUNT(su.url) FILTER (WHERE su.is_active)::int AS active_url_count,
              sc.last_success_at, sc.last_attempt_at
       FROM source_targets st
       LEFT JOIN sitemap_urls su ON su.source_target_id = st.id
       LEFT JOIN source_cursors sc ON sc.source_target_id = st.id
       WHERE st.source_type = 'sitemap'
       GROUP BY st.id, sc.last_success_at, sc.last_attempt_at
       ORDER BY st.name`
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      scope: String(row.scope),
      enabled: Boolean(row.enabled),
      config: (row.config ?? {}) as Record<string, unknown>,
      totalUrlCount: Number(row.total_url_count ?? 0),
      activeUrlCount: Number(row.active_url_count ?? 0),
      lastSuccessAt: row.last_success_at ? new Date(String(row.last_success_at)).toISOString() : undefined,
      lastAttemptAt: row.last_attempt_at ? new Date(String(row.last_attempt_at)).toISOString() : undefined
    }))
  }

  async getTarget(targetId: string): Promise<SourceTarget | undefined> {
    const result = await this.db.query(
      `SELECT * FROM source_targets WHERE id = $1 AND source_type = 'sitemap'`,
      [targetId]
    )
    const row = result.rows[0] as Record<string, unknown> | undefined
    return row ? toTarget(row) : undefined
  }

  async saveTarget(target: SourceTarget): Promise<void> {
    if (target.sourceType !== "sitemap") throw new Error("SitemapRepository only accepts sitemap targets")
    await this.db.query(
      `INSERT INTO source_targets (id, source_type, name, scope, enabled, config)
       VALUES ($1, 'sitemap', $2, $3, $4, $5::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         scope = EXCLUDED.scope,
         enabled = EXCLUDED.enabled,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [target.id, target.name, target.scope, target.enabled, JSON.stringify(target.config)]
    )
  }

  async listSignals(since: Date, targetId?: string): Promise<SitemapSignalRow[]> {
    const result = targetId
      ? await this.db.query(
          `SELECT rs.id, rs.source_target_id, st.name AS target_name, rs.url, rs.title,
                  rs.discovered_at, rs.metadata
           FROM raw_signals rs
           JOIN source_targets st ON st.id = rs.source_target_id
           WHERE rs.source_type = 'sitemap' AND rs.discovered_at >= $1 AND rs.source_target_id = $2
           ORDER BY rs.discovered_at DESC`,
          [since, targetId]
        )
      : await this.db.query(
          `SELECT rs.id, rs.source_target_id, st.name AS target_name, rs.url, rs.title,
                  rs.discovered_at, rs.metadata
           FROM raw_signals rs
           JOIN source_targets st ON st.id = rs.source_target_id
           WHERE rs.source_type = 'sitemap' AND rs.discovered_at >= $1
           ORDER BY rs.discovered_at DESC`,
          [since]
        )

    return result.rows.map((row) => {
      const metadata = (row.metadata ?? {}) as Record<string, unknown>
      return {
        id: String(row.id),
        targetId: String(row.source_target_id),
        targetName: String(row.target_name),
        url: row.url ? String(row.url) : undefined,
        title: row.title ? String(row.title) : undefined,
        keyword: typeof metadata.keyword === "string" ? metadata.keyword : undefined,
        pageTitle: typeof metadata.pageTitle === "string" ? metadata.pageTitle : undefined,
        h1: typeof metadata.h1 === "string" ? metadata.h1 : undefined,
        discoveredAt: new Date(String(row.discovered_at)).toISOString()
      }
    })
  }

  async listRuns(limit = 50): Promise<SitemapRunRow[]> {
    const result = await this.db.query(
      `SELECT crt.run_id, crt.source_target_id, st.name AS target_name, crt.status,
              crt.signal_count, crt.error, crt.started_at, crt.finished_at
       FROM collection_run_targets crt
       JOIN source_targets st ON st.id = crt.source_target_id
       WHERE st.source_type = 'sitemap'
       ORDER BY crt.started_at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => ({
      runId: String(row.run_id),
      targetId: String(row.source_target_id),
      targetName: String(row.target_name),
      status: String(row.status),
      signalCount: Number(row.signal_count ?? 0),
      error: row.error ? String(row.error) : undefined,
      startedAt: new Date(String(row.started_at)).toISOString(),
      finishedAt: row.finished_at ? new Date(String(row.finished_at)).toISOString() : undefined
    }))
  }

  async listAnomalies(): Promise<SitemapAnomaly[]> {
    const targets = await this.listTargets()
    const runs = await this.listRuns(200)
    const latestByTarget = new Map<string, SitemapRunRow>()
    for (const run of runs) {
      if (!latestByTarget.has(run.targetId)) latestByTarget.set(run.targetId, run)
    }

    const anomalies: SitemapAnomaly[] = []
    const staleBefore = Date.now() - 12 * 60 * 60 * 1000
    for (const target of targets.filter((item) => item.enabled)) {
      const latest = latestByTarget.get(target.id)
      if (latest?.status === "FAILED") {
        anomalies.push({
          severity: "critical",
          code: "LAST_RUN_FAILED",
          targetId: target.id,
          message: `${target.name}: ${latest.error ?? "last collection failed"}`,
          recordedAt: latest.startedAt
        })
        continue
      }
      if (!target.lastSuccessAt) {
        anomalies.push({
          severity: "warning",
          code: "NO_SUCCESSFUL_RUN",
          targetId: target.id,
          message: `${target.name}: no successful sitemap collection yet`
        })
        continue
      }
      if (new Date(target.lastSuccessAt).getTime() < staleBefore) {
        anomalies.push({
          severity: "warning",
          code: "STALE_SOURCE",
          targetId: target.id,
          message: `${target.name}: no successful collection in the last 12 hours`,
          recordedAt: target.lastSuccessAt
        })
      }
    }
    return anomalies
  }
}
