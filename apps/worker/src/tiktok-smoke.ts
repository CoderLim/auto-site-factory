import { Database } from "@factory/database"

type SummaryRow = {
  items: number
  video_items: number
  discovery_items: number
  snapshots: number
  creators: number
  snapshots_6h: number
}

type ItemRow = {
  external_id: string
  title: string | null
  author: string | null
  provider: string | null
  content_type: string | null
  observed_at: string | Date | null
  views: number | string | null
  likes: number | string | null
  comments: number | string | null
  shares: number | string | null
}

const db = new Database()

try {
  const summary = await db.query<SummaryRow>(
    `SELECT
       COUNT(DISTINCT rs.id)::int AS items,
       (COUNT(DISTINCT rs.id) FILTER (WHERE rs.metadata->>'contentType' = 'video'))::int AS video_items,
       (COUNT(DISTINCT rs.id) FILTER (WHERE rs.metadata->>'contentType' IN ('hashtag', 'music', 'creator', 'topic')))::int AS discovery_items,
       COUNT(sms.id)::int AS snapshots,
       COUNT(DISTINCT NULLIF(rs.author, ''))::int AS creators,
       (COUNT(sms.id) FILTER (WHERE sms.observed_at >= NOW() - INTERVAL '6 hours'))::int AS snapshots_6h
     FROM raw_signals rs
     JOIN source_targets st ON st.id = rs.source_target_id
     LEFT JOIN signal_metric_snapshots sms ON sms.raw_signal_id = rs.id
     WHERE rs.source_type = 'tiktok'
       AND st.scope = 'viral'`
  )

  const items = await db.query<ItemRow>(
    `SELECT
       rs.external_id,
       LEFT(rs.title, 180) AS title,
       rs.author,
       rs.metadata->>'provider' AS provider,
       rs.metadata->>'contentType' AS content_type,
       latest.observed_at,
       latest.views,
       latest.score AS likes,
       latest.comments,
       latest.shares
     FROM raw_signals rs
     JOIN source_targets st ON st.id = rs.source_target_id
     LEFT JOIN LATERAL (
       SELECT observed_at, views, score, comments, shares
       FROM signal_metric_snapshots
       WHERE raw_signal_id = rs.id
       ORDER BY observed_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE rs.source_type = 'tiktok'
       AND st.scope = 'viral'
     ORDER BY COALESCE(latest.observed_at, rs.discovered_at) DESC
     LIMIT 10`
  )

  console.log(JSON.stringify({
    event: "tiktok_smoke_report",
    summary: summary.rows[0] ?? {
      items: 0,
      video_items: 0,
      discovery_items: 0,
      snapshots: 0,
      creators: 0,
      snapshots_6h: 0
    },
    topItems: items.rows.map((row) => ({
      externalId: row.external_id,
      title: row.title,
      author: row.author,
      provider: row.provider,
      contentType: row.content_type,
      observedAt: row.observed_at ? new Date(row.observed_at).toISOString() : null,
      views: row.views == null ? null : Number(row.views),
      likes: row.likes == null ? null : Number(row.likes),
      comments: row.comments == null ? null : Number(row.comments),
      shares: row.shares == null ? null : Number(row.shares)
    }))
  }, null, 2))
} finally {
  await db.close()
}
