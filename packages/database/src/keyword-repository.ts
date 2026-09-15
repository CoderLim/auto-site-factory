import { newId, type SignalSourceType } from "@factory/shared"
import type { Database } from "./client.js"

export type KeywordSeedRow = {
  entityId: string
  name: string
  entityType: string
  scope: string
  firstSeenAt: string
  lastSeenAt: string
}

export type KeywordCandidateInput = {
  entityId: string
  keyword: string
  normalizedKeyword: string
  status: "pending_validation" | "low_searchability"
  searchabilityScore: number
  generationKind: "entity_name" | "scope_context"
  generationReasons: string[]
  firstSeenAt: string
  lastSeenAt: string
}

export type KeywordCandidateRow = KeywordCandidateInput & {
  id: string
  entityName: string
  entityType: string
  scope: string
  sourceTypes: string[]
  mentionCount: number
}

const ELIGIBLE_MENTION = `
  COALESCE(st.config->>'sourceRole', 'discovery') <> 'tracking'
  AND NOT (
    rs.source_type = 'wiki'
    AND COALESCE(rs.metadata->>'changeType', '') = 'edit'
  )
`

export class KeywordRepository {
  constructor(private readonly db: Database) {}

  async deleteInvalidOperationalScopeKeywords(scopes: string[] = ["viral"]): Promise<number> {
    if (scopes.length === 0) return 0
    const result = await this.db.query(
      `DELETE FROM keyword_candidates kc
       USING entities e
       WHERE kc.entity_id = e.id
         AND e.scope = ANY($1::TEXT[])
         AND kc.generation_kind = 'scope_context'`,
      [scopes]
    )
    return result.rowCount ?? 0
  }

  async deleteIneligibleKeywords(): Promise<number> {
    const result = await this.db.query(
      `DELETE FROM keyword_candidates kc
       WHERE NOT EXISTS (
         SELECT 1
         FROM entity_mentions em
         JOIN raw_signals rs ON rs.id = em.raw_signal_id
         JOIN source_targets st ON st.id = rs.source_target_id
         WHERE em.entity_id = kc.entity_id
           AND ${ELIGIBLE_MENTION}
       )`
    )
    return result.rowCount ?? 0
  }

  async listMissingSeeds(limit = 1000): Promise<KeywordSeedRow[]> {
    const result = await this.db.query(
      `SELECT e.id AS entity_id, e.canonical_name, e.entity_type, e.scope,
              eligible.first_seen_at, eligible.last_seen_at
       FROM candidates c
       JOIN entities e ON e.id = c.entity_id
       JOIN LATERAL (
         SELECT MIN(rs.discovered_at) AS first_seen_at,
                MAX(rs.discovered_at) AS last_seen_at
         FROM entity_mentions em
         JOIN raw_signals rs ON rs.id = em.raw_signal_id
         JOIN source_targets st ON st.id = rs.source_target_id
         WHERE em.entity_id = e.id
           AND ${ELIGIBLE_MENTION}
       ) eligible ON eligible.first_seen_at IS NOT NULL
       LEFT JOIN keyword_candidates kc ON kc.entity_id = e.id
       WHERE kc.id IS NULL
       ORDER BY eligible.first_seen_at ASC, c.id ASC
       LIMIT $1`,
      [limit]
    )

    return result.rows.map((row) => ({
      entityId: String(row.entity_id),
      name: String(row.canonical_name),
      entityType: String(row.entity_type),
      scope: String(row.scope),
      firstSeenAt: new Date(String(row.first_seen_at)).toISOString(),
      lastSeenAt: new Date(String(row.last_seen_at)).toISOString()
    }))
  }

  async saveGenerated(items: KeywordCandidateInput[]): Promise<number> {
    if (items.length === 0) return 0
    const payload = items.map((item) => ({ id: newId("kw"), ...item }))
    const result = await this.db.query(
      `INSERT INTO keyword_candidates (
         id, entity_id, keyword, normalized_keyword, status, searchability_score,
         generation_kind, generation_reasons, first_seen_at, last_seen_at
       )
       SELECT item.id, item."entityId", item.keyword, item."normalizedKeyword",
              item.status, item."searchabilityScore", item."generationKind",
              item."generationReasons", item."firstSeenAt", item."lastSeenAt"
       FROM jsonb_to_recordset($1::jsonb) AS item(
         id TEXT, "entityId" TEXT, keyword TEXT, "normalizedKeyword" TEXT,
         status TEXT, "searchabilityScore" INTEGER, "generationKind" TEXT,
         "generationReasons" JSONB, "firstSeenAt" TIMESTAMPTZ, "lastSeenAt" TIMESTAMPTZ
       )
       ON CONFLICT (entity_id, normalized_keyword) DO UPDATE SET
         keyword = EXCLUDED.keyword,
         status = EXCLUDED.status,
         searchability_score = EXCLUDED.searchability_score,
         generation_kind = EXCLUDED.generation_kind,
         generation_reasons = EXCLUDED.generation_reasons,
         last_seen_at = GREATEST(keyword_candidates.last_seen_at, EXCLUDED.last_seen_at),
         updated_at = NOW()`,
      [JSON.stringify(payload)]
    )
    return result.rowCount ?? 0
  }

  async listKeywords(
    since: Date,
    options: { sourceType?: SignalSourceType; status?: string; limit?: number } = {}
  ): Promise<KeywordCandidateRow[]> {
    const limit = options.limit ?? 500
    const params: unknown[] = [since.toISOString()]
    const where = ["eligible.first_seen_at >= $1"]

    if (options.status) {
      params.push(options.status)
      where.push(`kc.status = $${params.length}`)
    }
    if (options.sourceType) {
      params.push(options.sourceType)
      where.push(`$${params.length} = ANY(eligible.source_types)`)
    }
    params.push(limit)

    const result = await this.db.query(
      `SELECT kc.id, kc.entity_id, kc.keyword, kc.normalized_keyword, kc.status,
              kc.searchability_score, kc.generation_kind, kc.generation_reasons,
              eligible.first_seen_at, eligible.last_seen_at,
              e.canonical_name, e.entity_type, e.scope,
              eligible.source_types, eligible.mention_count
       FROM keyword_candidates kc
       JOIN entities e ON e.id = kc.entity_id
       JOIN candidates c ON c.entity_id = kc.entity_id
       JOIN LATERAL (
         SELECT ARRAY_AGG(DISTINCT rs.source_type)::TEXT[] AS source_types,
                COUNT(*)::int AS mention_count,
                MIN(rs.discovered_at) AS first_seen_at,
                MAX(rs.discovered_at) AS last_seen_at
         FROM entity_mentions em
         JOIN raw_signals rs ON rs.id = em.raw_signal_id
         JOIN source_targets st ON st.id = rs.source_target_id
         WHERE em.entity_id = kc.entity_id
           AND ${ELIGIBLE_MENTION}
       ) eligible ON eligible.mention_count > 0
       WHERE ${where.join(" AND ")}
       ORDER BY eligible.first_seen_at DESC, kc.searchability_score DESC, kc.id DESC
       LIMIT $${params.length}`,
      params
    )

    return result.rows.map((row) => ({
      id: String(row.id),
      entityId: String(row.entity_id),
      keyword: String(row.keyword),
      normalizedKeyword: String(row.normalized_keyword),
      status: String(row.status) as KeywordCandidateRow["status"],
      searchabilityScore: Number(row.searchability_score ?? 0),
      generationKind: String(row.generation_kind) as KeywordCandidateRow["generationKind"],
      generationReasons: Array.isArray(row.generation_reasons) ? row.generation_reasons.map(String) : [],
      firstSeenAt: new Date(String(row.first_seen_at)).toISOString(),
      lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
      entityName: String(row.canonical_name),
      entityType: String(row.entity_type),
      scope: String(row.scope),
      sourceTypes: Array.isArray(row.source_types) ? row.source_types.map(String) : [],
      mentionCount: Number(row.mention_count ?? 0)
    }))
  }
}
