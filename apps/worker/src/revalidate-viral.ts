import { Database, DiscoveryRepository } from "@factory/database"
import { extractEntities, normalizeEntityName } from "@factory/discovery"
import type { SignalSourceType, StoredSignal } from "@factory/shared"

const DEFAULT_HOURS = 30 * 24
const parsedHours = Number(process.env.VIRAL_REVALIDATE_HOURS ?? DEFAULT_HOURS)
const hours = Number.isFinite(parsedHours) ? Math.min(90 * 24, Math.max(24, parsedHours)) : DEFAULT_HOURS
const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)

const db = new Database()
const discovery = new DiscoveryRepository(db)

type SignalRow = {
  id: string
  source_type: SignalSourceType
  source_target_id: string
  external_id: string
  title: string | null
  content: string | null
  url: string | null
  author: string | null
  published_at: string | Date | null
  discovered_at: string | Date
  metadata: Record<string, unknown> | null
  fingerprint: string
  scope: string
}

function storedSignal(row: SignalRow): StoredSignal {
  return {
    id: String(row.id),
    sourceType: row.source_type,
    sourceTargetId: String(row.source_target_id),
    externalId: String(row.external_id),
    title: row.title ? String(row.title) : undefined,
    content: row.content ? String(row.content) : undefined,
    url: row.url ? String(row.url) : undefined,
    author: row.author ? String(row.author) : undefined,
    publishedAt: row.published_at ? new Date(row.published_at) : undefined,
    discoveredAt: new Date(row.discovered_at),
    metadata: row.metadata ?? {},
    fingerprint: String(row.fingerprint),
    scope: String(row.scope)
  }
}

try {
  const rows = await db.query<SignalRow>(
    `SELECT rs.*, st.scope
     FROM raw_signals rs
     JOIN source_targets st ON st.id = rs.source_target_id
     WHERE st.scope = 'viral'
       AND rs.discovered_at >= $1
     ORDER BY rs.discovered_at ASC, rs.id ASC`,
    [cutoff.toISOString()]
  )

  const signalIds = rows.rows.map((row) => String(row.id))
  let removedMentions = 0
  if (signalIds.length > 0) {
    const removed = await db.query(
      `DELETE FROM entity_mentions
       WHERE raw_signal_id = ANY($1::text[])`,
      [signalIds]
    )
    removedMentions = removed.rowCount ?? 0
  }

  const activeEntityIds = new Set<string>()
  let extractedCount = 0
  let mentionAttempts = 0
  let newCandidates = 0

  for (const row of rows.rows) {
    const signal = storedSignal(row)
    const entities = await extractEntities(signal)
    extractedCount += entities.length

    const seen = new Set<string>()
    for (const entity of entities) {
      const normalizedName = normalizeEntityName(entity.name)
      if (!normalizedName || normalizedName.length < 2) continue
      const key = `${entity.type}:${normalizedName}`
      if (seen.has(key)) continue
      seen.add(key)

      const result = await discovery.registerEntityMention(signal, entity, normalizedName)
      activeEntityIds.add(result.entityId)
      mentionAttempts += 1
      if (result.candidateCreated) newCandidates += 1
    }
  }

  const rebuilt = await db.query(
    `WITH stats AS (
       SELECT
         e.id AS entity_id,
         COUNT(em.id)::int AS mention_count,
         COUNT(DISTINCT em.source_type)::int AS source_count,
         COALESCE(
           ARRAY_AGG(DISTINCT em.source_type) FILTER (WHERE em.source_type IS NOT NULL),
           ARRAY[]::text[]
         ) AS source_types,
         MIN(rs.discovered_at) AS first_seen_at,
         MAX(rs.discovered_at) AS last_seen_at
       FROM entities e
       LEFT JOIN entity_mentions em ON em.entity_id = e.id
       LEFT JOIN raw_signals rs ON rs.id = em.raw_signal_id
       WHERE e.scope = 'viral'
       GROUP BY e.id
     )
     UPDATE candidates c
     SET mention_count = stats.mention_count,
         source_count = stats.source_count,
         source_types = stats.source_types,
         first_seen_at = COALESCE(stats.first_seen_at, c.first_seen_at),
         last_seen_at = COALESCE(stats.last_seen_at, c.last_seen_at),
         updated_at = NOW()
     FROM stats
     WHERE c.entity_id = stats.entity_id`
  )

  const filterResult = await db.query(
    `UPDATE candidates c
     SET status = 'filtered_noise', updated_at = NOW()
     FROM entities e
     WHERE e.id = c.entity_id
       AND e.scope = 'viral'
       AND c.last_seen_at >= $1
       AND c.status IN ('pending_validation', 'filtered_noise')`,
    [cutoff.toISOString()]
  )

  let reactivated = 0
  if (activeEntityIds.size > 0) {
    const activeResult = await db.query(
      `UPDATE candidates
       SET status = CASE WHEN status = 'filtered_noise' THEN 'pending_validation' ELSE status END,
           updated_at = NOW()
       WHERE entity_id = ANY($1::text[])
       RETURNING id`,
      [[...activeEntityIds]]
    )
    reactivated = activeResult.rowCount ?? 0
  }

  const summary = await db.query<{ status: string; count: number }>(
    `SELECT c.status, COUNT(*)::int AS count
     FROM candidates c
     JOIN entities e ON e.id = c.entity_id
     WHERE e.scope = 'viral'
       AND c.last_seen_at >= $1
     GROUP BY c.status
     ORDER BY c.status`,
    [cutoff.toISOString()]
  )

  console.log(JSON.stringify({
    event: "viral_revalidation_complete",
    hours,
    cutoff: cutoff.toISOString(),
    signalsScanned: rows.rowCount ?? rows.rows.length,
    removedMentions,
    extractedCount,
    mentionAttempts,
    newCandidates,
    rebuiltCandidates: rebuilt.rowCount ?? 0,
    initiallyFiltered: filterResult.rowCount ?? 0,
    activeEntityCount: activeEntityIds.size,
    reactivated,
    statuses: summary.rows
  }, null, 2))
} finally {
  await db.close()
}
