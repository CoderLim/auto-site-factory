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


export interface SitemapDiscoveredPage {
  url: string
  keyword?: string
  pageTitle?: string
  h1?: string
  firstSeenAt: string
  lastSeenAt: string
  active: boolean
  isBaseline: boolean
  matchSource?: "title" | "url"
}

export interface SitemapDiscoveredResult {
  pages: SitemapDiscoveredPage[]
  discoveredCount: number
  generatorCount: number
  baselineCount: number
  baselineGeneratorCount: number
  matchedCount: number
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
    limit: number,
    suppressNew = false
  ): Promise<SitemapReconcileResult> {
    const existing = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM sitemap_urls WHERE source_target_id = $1`,
      [targetId]
    )
    const initialized = (existing.rows[0]?.count ?? 0) > 0
    const shouldSuppressNew = suppressNew || (!initialized && baselineOnFirstRun)
    const payload = entries.map((entry) => ({
      url: entry.url,
      keyword: entry.keyword ?? null
    }))

    const seenAtIso = seenAt.toISOString()

    if (payload.length > 0) {
      await this.db.query(
        `INSERT INTO sitemap_urls (
           source_target_id, url, keyword, first_seen_at, last_seen_at, signal_emitted_at, is_active
         )
         SELECT $1::text, item.url, item.keyword, $3::timestamptz, $3::timestamptz,
                CASE WHEN $4::boolean THEN $3::timestamptz ELSE NULL END, TRUE
         FROM jsonb_to_recordset($2::jsonb) AS item(url TEXT, keyword TEXT)
         ON CONFLICT (source_target_id, url) DO UPDATE SET
           keyword = COALESCE(EXCLUDED.keyword, sitemap_urls.keyword),
           last_seen_at = EXCLUDED.last_seen_at,
           is_active = TRUE`,
        [targetId, JSON.stringify(payload), seenAtIso, shouldSuppressNew]
      )
    }

    await this.db.query(
      `UPDATE sitemap_urls
       SET is_active = FALSE
       WHERE source_target_id = $1 AND last_seen_at < $2::timestamptz`,
      [targetId, seenAtIso]
    )

    const pendingCountResult = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM sitemap_urls
       WHERE source_target_id = $1 AND signal_emitted_at IS NULL AND is_active = TRUE`,
      [targetId]
    )
    const pending = await this.db.query<{ url: string; first_seen_at: Date }>(
      `SELECT url, first_seen_at
       FROM sitemap_urls
       WHERE source_target_id = $1 AND signal_emitted_at IS NULL AND is_active = TRUE
       ORDER BY first_seen_at ASC, url ASC
       LIMIT $2`,
      [targetId, limit]
    )

    const pendingEntries = pending.rows.map((row) => ({
      url: row.url,
      firstSeenAt: new Date(row.first_seen_at)
    }))

    return {
      initialized,
      pendingUrls: pendingEntries.map((entry) => entry.url),
      pendingEntries,
      pendingCount: pendingCountResult.rows[0]?.count ?? 0
    }
  }

  async markEmitted(targetId: string, urls: string[], emittedAt: Date): Promise<void> {
    if (urls.length === 0) return
    await this.db.query(
      `UPDATE sitemap_urls
       SET signal_emitted_at = COALESCE(signal_emitted_at, $3::timestamptz)
       WHERE source_target_id = $1 AND url = ANY($2::text[])`,
      [targetId, urls, emittedAt.toISOString()]
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


  /**
   * New = URL first seen after initial sitemap baseline, evidenced by a RawSignal.
   * Baseline = URL already present on initial crawl. Baseline page titles were not
   * fetched, so matching its URL slug is explicitly a candidate, not a title match.
   * Neither first_seen_at nor last_seen_at represents Google's first indexing date.
   */
  async listDiscoveredPages(
    targetId: string,
    since: Date,
    generatorsOnly = true,
    view: "all" | "new" | "baseline" = "all",
    search = "",
    limit = 200
  ): Promise<SitemapDiscoveredResult> {
    const titleWords = `(' ' || regexp_replace(lower(COALESCE(su.page_title, '')), '[^a-z0-9]+', ' ', 'g') || ' ')`
    const urlWords = `(' ' || regexp_replace(lower(su.url), '[^a-z0-9]+', ' ', 'g') || ' ')`
    const titleMatch = `(${titleWords} LIKE '% ai %' AND ${titleWords} LIKE '% generator %')`
    const urlMatch = `(${urlWords} LIKE '% ai %' AND ${urlWords} LIKE '% generator %')`
    const generatorMatch = `(${titleMatch} OR ((su.page_title IS NULL OR su.page_title = '') AND ${urlMatch}))`
    const isNew = `EXISTS (
      SELECT 1 FROM raw_signals rs
      WHERE rs.source_type = 'sitemap'
        AND rs.source_target_id = su.source_target_id
        AND rs.external_id = su.url
    )`
    const newInRange = `(${isNew} AND su.first_seen_at >= $2::timestamptz)`
    const baseline = `NOT (${isNew})`
    const viewWhere = view === "new"
      ? newInRange
      : view === "baseline"
        ? baseline
        : `(${newInRange} OR ${baseline})`
    const searchWhere = `($4::text = '' OR
      su.url ILIKE '%' || $4 || '%'
      OR COALESCE(su.page_title, '') ILIKE '%' || $4 || '%'
      OR COALESCE(su.keyword, '') ILIKE '%' || $4 || '%')`
    const params = [targetId, since.toISOString()]
    const [counts, result] = await Promise.all([
      this.db.query<{
        discovered_count: number
        generator_count: number
        baseline_count: number
        baseline_generator_count: number
      }>(
        `SELECT COUNT(*) FILTER (WHERE ${newInRange})::int AS discovered_count,
           COUNT(*) FILTER (WHERE ${newInRange} AND ${generatorMatch})::int AS generator_count,
           COUNT(*) FILTER (WHERE ${baseline})::int AS baseline_count,
           COUNT(*) FILTER (WHERE ${baseline} AND ${generatorMatch})::int AS baseline_generator_count
         FROM sitemap_urls su WHERE su.source_target_id = $1`,
        params
      ),
      this.db.query(
        `SELECT su.url, su.keyword, su.page_title, su.h1, su.first_seen_at, su.last_seen_at, su.is_active,
                ${isNew} AS is_new,
                CASE WHEN ${titleMatch} THEN 'title'
                     WHEN su.page_title IS NULL OR su.page_title = '' THEN
                       CASE WHEN ${urlMatch} THEN 'url' ELSE NULL END
                     ELSE NULL END AS match_source,
                COUNT(*) OVER()::int AS matched_count
         FROM sitemap_urls su
         WHERE su.source_target_id = $1 AND ${viewWhere}
           AND ${searchWhere}
           ${generatorsOnly ? `AND ${generatorMatch}` : ""}
         ORDER BY is_new DESC, su.first_seen_at DESC, su.url ASC
         LIMIT $3`,
        [targetId, since.toISOString(), Math.max(1, Math.min(limit, 500)), search.trim()]
      )
    ])
    return {
      discoveredCount: Number(counts.rows[0]?.discovered_count ?? 0),
      generatorCount: Number(counts.rows[0]?.generator_count ?? 0),
      baselineCount: Number(counts.rows[0]?.baseline_count ?? 0),
      baselineGeneratorCount: Number(counts.rows[0]?.baseline_generator_count ?? 0),
      matchedCount: Number(result.rows[0]?.matched_count ?? 0),
      pages: result.rows.map((row) => ({
        url: String(row.url),
        keyword: row.keyword ? String(row.keyword) : undefined,
        pageTitle: row.page_title ? String(row.page_title) : undefined,
        h1: row.h1 ? String(row.h1) : undefined,
        firstSeenAt: new Date(String(row.first_seen_at)).toISOString(),
        lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
        active: Boolean(row.is_active),
        isBaseline: !Boolean(row.is_new),
        matchSource: row.match_source === "title" || row.match_source === "url"
          ? row.match_source
          : undefined
      }))
    }
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
