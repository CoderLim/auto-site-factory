import { Database, DiscoveryRepository } from "@factory/database"
import { extractEntities, normalizeEntityName } from "@factory/discovery"
import type { SignalSourceType, StoredSignal } from "@factory/shared"

const DEFAULT_HOURS = 30 * 24
const parsedHours = Number(process.env.VIRAL_REVALIDATE_HOURS ?? DEFAULT_HOURS)
const hours = Number.isFinite(parsedHours) ? Math.min(90 * 24, Math.max(24, parsedHours)) : DEFAULT_HOURS
const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000)
const sourceFilterRaw = process.env.VIRAL_REVALIDATE_SOURCE?.trim()
const sourceFilter = sourceFilterRaw ? sourceFilterRaw as SignalSourceType : undefined

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

type ExpectedMention = {
  rawSignalId: string
  entityId: string
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
       AND ($2::text IS NULL OR rs.source_type = $2)
     ORDER BY rs.discovered_at ASC, rs.id ASC`,
    [cutoff.toISOString(), sourceFilter ?? null]
  )

  const signalIds = rows.rows.map((row) => String(row.id))
  const activeEntityIds = new Set<string>()
  const expectedMentions: ExpectedMention[] = []
  let extractedCount = 0
  let mentionAttempts = 0
  let newCandidates = 0

  // Re-extract first without deleting anything. If this process is interrupted before
  // reconciliation, production data stays in its previous consistent state.
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
      expectedMentions.push({ rawSignalId: signal.id, entityId: result.entityId })
      mentionAttempts += 1
      if (result.candidateCreated) newCandidates += 1
    }
  }

  let removedMentions = 0
  let rebuiltCandidates = 0
  if (signalIds.length > 0) {
    const reconciled = await db.query<{ removed_mentions: number; rebuilt_candidates: number }>(
      `WITH scoped_signals AS (
         SELECT UNNEST($1::text[]) AS raw_signal_id
       ),
       expected AS (
         SELECT item->>'rawSignalId' AS raw_signal_id,
                item->>'entityId' AS entity_id
         FROM jsonb_array_elements($2::jsonb) item
       ),
       deleted AS (
         DELETE FROM entity_mentions em
         USING scoped_signals ss
         WHERE em.raw_signal_id = ss.raw_signal_id
           AND NOT EXISTS (
             SELECT 1
             FROM expected ex
             WHERE ex.raw_signal_id = em.raw_signal_id
               AND ex.entity_id = em.entity_id
           )
         RETURNING em.entity_id
       ),
       stats AS (
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
       ),
       updated AS (
         UPDATE candidates c
         SET mention_count = stats.mention_count,
             source_count = stats.source_count,
             source_types = stats.source_types,
             first_seen_at = COALESCE(stats.first_seen_at, c.first_seen_at),
             last_seen_at = COALESCE(stats.last_seen_at, c.last_seen_at),
             status = CASE
               WHEN c.status NOT IN ('pending_validation', 'filtered_noise') THEN c.status
               WHEN COALESCE(stats.last_seen_at, c.last_seen_at) < $4::timestamptz THEN c.status
               WHEN c.entity_id = ANY($3::text[]) THEN
                 CASE WHEN c.status = 'filtered_noise' THEN 'pending_validation' ELSE c.status END
               ELSE 'filtered_noise'
             END,
             updated_at = NOW()
         FROM stats
         WHERE c.entity_id = stats.entity_id
         RETURNING c.id
       )
       SELECT
         (SELECT COUNT(*)::int FROM deleted) AS removed_mentions,
         (SELECT COUNT(*)::int FROM updated) AS rebuilt_candidates`,
      [
        signalIds,
        JSON.stringify(expectedMentions),
        [...activeEntityIds],
        cutoff.toISOString()
      ]
    )
    removedMentions = Number(reconciled.rows[0]?.removed_mentions ?? 0)
    rebuiltCandidates = Number(reconciled.rows[0]?.rebuilt_candidates ?? 0)
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
    source: sourceFilter ?? "all",
    hours,
    cutoff: cutoff.toISOString(),
    signalsScanned: rows.rowCount ?? rows.rows.length,
    removedMentions,
    extractedCount,
    mentionAttempts,
    newCandidates,
    rebuiltCandidates,
    activeEntityCount: activeEntityIds.size,
    statuses: summary.rows
  }, null, 2))
} finally {
  await db.close()
}
