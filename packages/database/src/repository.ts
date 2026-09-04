import {
  newId,
  type CursorState,
  type ExtractedEntity,
  type RawSignal,
  type SourceTarget,
  type SignalSourceType,
  type StoredSignal
} from "@factory/shared"
import type { Database } from "./client.js"

function parseTarget(row: Record<string, unknown>): SourceTarget {
  return {
    id: String(row.id),
    sourceType: row.source_type as SignalSourceType,
    name: String(row.name),
    scope: String(row.scope),
    enabled: Boolean(row.enabled),
    config: (row.config ?? {}) as Record<string, unknown>
  }
}

const VIRAL_SOURCE_BONUS: Partial<Record<SignalSourceType, number>> = {
  twitch: 8,
  x: 8,
  youtube: 6,
  hn: 4,
  reddit: 4,
  rss: 2,
  official_api: 2,
  wiki: 1,
  wiki_gg: 1,
  sitemap: 1
}

export function calculateViralScore(input: {
  mentionCount: number
  sourceCount: number
  sourceTypes: string[]
  firstSeenAt: string
}, now = new Date()): number {
  const ageHours = Math.max(
    1,
    (now.getTime() - new Date(input.firstSeenAt).getTime()) / (60 * 60 * 1000)
  )
  const recency = ageHours <= 24 ? 15 : ageHours <= 72 ? 8 : ageHours <= 168 ? 3 : 0
  const diversity = Math.min(3, Math.max(0, input.sourceCount - 1)) * 20
  const repeatMentions = Math.min(15, Math.max(0, input.mentionCount - 1) * 3)
  const velocity = Math.min(
    20,
    Math.max(0, ((input.mentionCount - 1) / ageHours) * 24 * 4)
  )
  const sourceBonus = [...new Set(input.sourceTypes)]
    .reduce((sum, source) => sum + (VIRAL_SOURCE_BONUS[source as SignalSourceType] ?? 0), 0)

  return Math.min(100, Math.round(recency + diversity + repeatMentions + velocity + sourceBonus))
}

export type DiscoveryCandidateRow = {
  id: string
  entityId: string
  name: string
  entityType: string
  scope: string
  status: string
  mentionCount: number
  sourceCount: number
  sourceTypes: string[]
  viralScore: number
  firstSeenAt: string
  lastSeenAt: string
}

export class DiscoveryRepository {
  constructor(private readonly db: Database) {}

  async countEnabledTargets(): Promise<number> {
    const result = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM source_targets WHERE enabled = TRUE`
    )
    return result.rows[0]?.count ?? 0
  }

  async listCandidates(
    since: Date,
    options: { sourceType?: SignalSourceType; limit?: number } = {}
  ): Promise<DiscoveryCandidateRow[]> {
    const limit = options.limit ?? 500
    const result = options.sourceType
      ? await this.db.query(
          `SELECT c.id, c.entity_id, e.canonical_name, e.entity_type, e.scope,
                  c.status, c.mention_count, c.source_count, c.source_types,
                  c.first_seen_at, c.last_seen_at
           FROM candidates c
           JOIN entities e ON e.id = c.entity_id
           WHERE c.first_seen_at >= $1 AND $2 = ANY(c.source_types)
           ORDER BY c.first_seen_at DESC, c.id DESC
           LIMIT $3`,
          [since.toISOString(), options.sourceType, limit]
        )
      : await this.db.query(
          `SELECT c.id, c.entity_id, e.canonical_name, e.entity_type, e.scope,
                  c.status, c.mention_count, c.source_count, c.source_types,
                  c.first_seen_at, c.last_seen_at
           FROM candidates c
           JOIN entities e ON e.id = c.entity_id
           WHERE c.first_seen_at >= $1
           ORDER BY c.first_seen_at DESC, c.id DESC
           LIMIT $2`,
          [since.toISOString(), limit]
        )

    const candidates = result.rows.map((row) => {
      const sourceTypes = Array.isArray(row.source_types)
        ? row.source_types.map((item) => String(item))
        : []
      const mentionCount = Number(row.mention_count ?? 0)
      const sourceCount = Number(row.source_count ?? 0)
      const firstSeenAt = new Date(String(row.first_seen_at)).toISOString()
      const candidate = {
        id: String(row.id),
        entityId: String(row.entity_id),
        name: String(row.canonical_name),
        entityType: String(row.entity_type),
        scope: String(row.scope),
        status: String(row.status),
        mentionCount,
        sourceCount,
        sourceTypes,
        firstSeenAt,
        lastSeenAt: new Date(String(row.last_seen_at)).toISOString()
      }

      return {
        ...candidate,
        viralScore: calculateViralScore(candidate)
      }
    })

    return candidates.sort((a, b) =>
      b.viralScore - a.viralScore ||
      new Date(b.firstSeenAt).getTime() - new Date(a.firstSeenAt).getTime()
    )
  }

  async listEnabledTargets(sourceType?: SignalSourceType): Promise<SourceTarget[]> {
    const result = sourceType
      ? await this.db.query(
          `SELECT * FROM source_targets WHERE enabled = TRUE AND source_type = $1 ORDER BY id`,
          [sourceType]
        )
      : await this.db.query(
          `SELECT * FROM source_targets WHERE enabled = TRUE ORDER BY source_type, id`
        )
    return result.rows.map((row) => parseTarget(row as Record<string, unknown>))
  }

  async upsertSourceTarget(target: SourceTarget): Promise<void> {
    await this.db.query(
      `INSERT INTO source_targets (id, source_type, name, scope, enabled, config)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         name = EXCLUDED.name,
         scope = EXCLUDED.scope,
         enabled = EXCLUDED.enabled,
         config = EXCLUDED.config,
         updated_at = NOW()`,
      [
        target.id,
        target.sourceType,
        target.name,
        target.scope,
        target.enabled,
        JSON.stringify(target.config)
      ]
    )
  }

  async getCursor(targetId: string): Promise<CursorState | undefined> {
    const result = await this.db.query<{ cursor: CursorState }>(
      `SELECT cursor FROM source_cursors WHERE source_target_id = $1`,
      [targetId]
    )
    return result.rows[0]?.cursor
  }

  async markCursorAttempt(targetId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO source_cursors (source_target_id, cursor, last_attempt_at)
       VALUES ($1, '{}'::jsonb, NOW())
       ON CONFLICT (source_target_id) DO UPDATE SET last_attempt_at = NOW(), updated_at = NOW()`,
      [targetId]
    )
  }

  async saveCursor(targetId: string, cursor: CursorState): Promise<void> {
    await this.db.query(
      `INSERT INTO source_cursors (source_target_id, cursor, last_success_at, last_attempt_at)
       VALUES ($1, $2::jsonb, NOW(), NOW())
       ON CONFLICT (source_target_id) DO UPDATE SET
         cursor = EXCLUDED.cursor,
         last_success_at = NOW(),
         last_attempt_at = NOW(),
         updated_at = NOW()`,
      [targetId, JSON.stringify(cursor)]
    )
  }

  async createRun(id: string): Promise<void> {
    await this.db.query(`INSERT INTO collection_runs (id) VALUES ($1)`, [id])
  }

  async startRunTarget(runId: string, targetId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO collection_run_targets (run_id, source_target_id, status)
       VALUES ($1, $2, 'RUNNING')
       ON CONFLICT (run_id, source_target_id) DO UPDATE SET status = 'RUNNING', started_at = NOW()`,
      [runId, targetId]
    )
  }

  async finishRunTarget(
    runId: string,
    targetId: string,
    status: "SUCCESS" | "FAILED",
    signalCount: number,
    error?: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE collection_run_targets
       SET status = $3, signal_count = $4, error = $5, finished_at = NOW()
       WHERE run_id = $1 AND source_target_id = $2`,
      [runId, targetId, status, signalCount, error ?? null]
    )
  }

  async finishRun(
    runId: string,
    status: "SUCCESS" | "PARTIAL_SUCCESS" | "FAILED",
    signalCount: number,
    candidateCount: number,
    error?: string
  ): Promise<void> {
    await this.db.query(
      `UPDATE collection_runs
       SET status = $2, signal_count = $3, candidate_count = $4, error = $5, finished_at = NOW()
       WHERE id = $1`,
      [runId, status, signalCount, candidateCount, error ?? null]
    )
  }

  async insertSignals(signals: RawSignal[]): Promise<number> {
    let inserted = 0
    for (const signal of signals) {
      const result = await this.db.query(
        `INSERT INTO raw_signals (
          id, source_type, source_target_id, external_id, title, content, url, author,
          published_at, discovered_at, metadata, fingerprint
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
        ON CONFLICT (fingerprint) DO NOTHING`,
        [
          signal.id,
          signal.sourceType,
          signal.sourceTargetId,
          signal.externalId,
          signal.title ?? null,
          signal.content ?? null,
          signal.url ?? null,
          signal.author ?? null,
          signal.publishedAt ?? null,
          signal.discoveredAt,
          JSON.stringify(signal.metadata),
          signal.fingerprint
        ]
      )
      inserted += result.rowCount ?? 0
    }
    return inserted
  }

  async getPendingSignals(limit = 500): Promise<StoredSignal[]> {
    const result = await this.db.query(
      `SELECT rs.*, st.scope
       FROM raw_signals rs
       JOIN source_targets st ON st.id = rs.source_target_id
       WHERE rs.processed_at IS NULL
       ORDER BY rs.discovered_at ASC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      sourceType: row.source_type as SignalSourceType,
      sourceTargetId: String(row.source_target_id),
      externalId: String(row.external_id),
      title: row.title ? String(row.title) : undefined,
      content: row.content ? String(row.content) : undefined,
      url: row.url ? String(row.url) : undefined,
      author: row.author ? String(row.author) : undefined,
      publishedAt: row.published_at ? new Date(String(row.published_at)) : undefined,
      discoveredAt: new Date(String(row.discovered_at)),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      fingerprint: String(row.fingerprint),
      scope: String(row.scope)
    }))
  }

  async markSignalProcessed(signalId: string): Promise<void> {
    await this.db.query(`UPDATE raw_signals SET processed_at = NOW() WHERE id = $1`, [signalId])
  }

  async registerEntityMention(
    signal: StoredSignal,
    entity: ExtractedEntity,
    normalizedName: string
  ): Promise<{ entityId: string; candidateCreated: boolean }> {
    const existing = await this.db.query<{ id: string; canonical_name: string }>(
      `SELECT id, canonical_name FROM entities WHERE scope = $1 AND normalized_name = $2 AND entity_type = $3`,
      [signal.scope, normalizedName, entity.type]
    )

    let entityId = existing.rows[0]?.id
    const canonicalName = existing.rows[0]?.canonical_name
    if (!entityId) {
      entityId = newId("ent")
      await this.db.query(
        `INSERT INTO entities (
          id, canonical_name, normalized_name, entity_type, scope, parent, first_seen_at, last_seen_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
        [
          entityId,
          entity.name,
          normalizedName,
          entity.type,
          signal.scope,
          entity.parent ?? null,
          signal.discoveredAt
        ]
      )
    } else {
      await this.db.query(
        `UPDATE entities SET last_seen_at = GREATEST(last_seen_at, $2), updated_at = NOW() WHERE id = $1`,
        [entityId, signal.discoveredAt]
      )
      if (canonicalName && canonicalName !== entity.name) {
        await this.db.query(
          `INSERT INTO entity_aliases (id, entity_id, alias, normalized_alias)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (entity_id, normalized_alias) DO NOTHING`,
          [newId("alias"), entityId, entity.name, normalizedName]
        )
      }
    }

    const mention = await this.db.query(
      `INSERT INTO entity_mentions (
        id, entity_id, raw_signal_id, source_type, confidence, evidence
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (entity_id, raw_signal_id) DO NOTHING`,
      [
        newId("mention"),
        entityId,
        signal.id,
        signal.sourceType,
        entity.confidence,
        entity.evidence ?? signal.title ?? signal.content ?? null
      ]
    )

    const candidateExisting = await this.db.query<{ id: string }>(
      `SELECT id FROM candidates WHERE entity_id = $1`,
      [entityId]
    )
    const candidateCreated = candidateExisting.rows.length === 0

    if (candidateCreated) {
      await this.db.query(
        `INSERT INTO candidates (
          id, entity_id, mention_count, source_count, source_types, first_seen_at, last_seen_at
        ) VALUES ($1,$2,$3,1,ARRAY[$4]::TEXT[],$5,$5)`,
        [
          newId("cand"),
          entityId,
          mention.rowCount ?? 0,
          signal.sourceType,
          signal.discoveredAt
        ]
      )
    } else if ((mention.rowCount ?? 0) > 0) {
      await this.db.query(
        `UPDATE candidates
         SET mention_count = mention_count + 1,
             source_types = CASE
               WHEN $2 = ANY(source_types) THEN source_types
               ELSE array_append(source_types, $2)
             END,
             source_count = CASE
               WHEN $2 = ANY(source_types) THEN source_count
               ELSE source_count + 1
             END,
             last_seen_at = GREATEST(last_seen_at, $3),
             updated_at = NOW()
         WHERE entity_id = $1`,
        [entityId, signal.sourceType, signal.discoveredAt]
      )
    }

    return { entityId, candidateCreated }
  }
}
