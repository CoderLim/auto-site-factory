import type { Database } from "./client.js"

export type AppChartSort = "rising" | "rank" | "new"

export interface AppChartTermInput {
  term: string
  displayTerm: string
}

export interface AppChartEntryInput {
  appId: string
  rank: number
  name: string
  artist?: string
  iconUrl?: string
  storeUrl?: string
  primaryGenreName?: string
  releaseDate?: string
  ratingCount?: number
  averageRating?: number
  terms: AppChartTermInput[]
}

export interface AppChartSnapshotInput {
  country: string
  chart: string
  genre: string
  capturedAt: string
  sourceUpdatedAt?: string
  entries: AppChartEntryInput[]
}

export interface AppChartEntrySummary {
  appId: string
  rank: number
  previousRank?: number
  rank6hDelta?: number
  rank24hAgo?: number
  rank24hDelta?: number
  name: string
  artist?: string
  iconUrl?: string
  storeUrl?: string
  primaryGenreName?: string
  releaseDate?: string
  ratingCount?: number
  averageRating?: number
  firstSeenAt: string
  lastSeenAt: string
  isBaseline: boolean
  isNewApp: boolean
  newTerms: string[]
  capturedAt: string
}

export interface AppChartNewTerm {
  term: string
  displayTerm: string
  firstSeenAt: string
  firstAppId?: string
  appName?: string
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

function toEntry(row: Record<string, unknown>): AppChartEntrySummary {
  const rank = Number(row.rank)
  const previousRank = optionalNumber(row.previous_rank)
  const rank24hAgo = optionalNumber(row.rank_24h_ago)
  return {
    appId: String(row.app_id),
    rank,
    previousRank,
    rank6hDelta: previousRank == null ? undefined : previousRank - rank,
    rank24hAgo,
    rank24hDelta: rank24hAgo == null ? undefined : rank24hAgo - rank,
    name: String(row.name),
    artist: optionalString(row.artist),
    iconUrl: optionalString(row.icon_url),
    storeUrl: optionalString(row.store_url),
    primaryGenreName: optionalString(row.primary_genre_name),
    releaseDate: optionalString(row.release_date),
    ratingCount: optionalNumber(row.rating_count),
    averageRating: optionalNumber(row.average_rating),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    isBaseline: Boolean(row.is_baseline),
    isNewApp: Boolean(row.is_new_app),
    newTerms: stringArray(row.new_terms),
    capturedAt: String(row.captured_at)
  }
}

export class AppChartRepository {
  constructor(private readonly db: Database) {}

  async recordSnapshot(input: AppChartSnapshotInput): Promise<{
    baseline: boolean
    insertedRanks: number
    newApps: string[]
    newTerms: AppChartNewTerm[]
  }> {
    if (input.entries.length === 0) {
      return { baseline: false, insertedRanks: 0, newApps: [], newTerms: [] }
    }

    const client = await this.db.pool.connect()
    try {
      await client.query("BEGIN")

      const scopeResult = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM app_chart_snapshots
           WHERE country = $1 AND chart = $2 AND genre = $3
         ) AS exists`,
        [input.country, input.chart, input.genre]
      )
      const baseline = !Boolean(scopeResult.rows[0]?.exists)

      const appIds = input.entries.map((entry) => entry.appId)
      const existingResult = await client.query<{ app_id: string }>(
        `SELECT app_id FROM app_chart_apps WHERE app_id = ANY($1::text[])`,
        [appIds]
      )
      const existingApps = new Set(existingResult.rows.map((row) => row.app_id))
      const newApps = input.entries.filter((entry) => !existingApps.has(entry.appId)).map((entry) => entry.appId)

      const appPayload = JSON.stringify(input.entries.map((entry) => ({
        app_id: entry.appId,
        name: entry.name,
        artist: entry.artist ?? null,
        icon_url: entry.iconUrl ?? null,
        store_url: entry.storeUrl ?? null,
        primary_genre_name: entry.primaryGenreName ?? null,
        release_date: entry.releaseDate ?? null,
        rating_count: entry.ratingCount ?? null,
        average_rating: entry.averageRating ?? null
      })))

      await client.query(
        `INSERT INTO app_chart_apps(
           app_id, name, artist, icon_url, store_url, primary_genre_name, release_date,
           rating_count, average_rating, first_seen_at, last_seen_at, is_baseline, created_at, updated_at
         )
         SELECT
           x.app_id, x.name, x.artist, x.icon_url, x.store_url, x.primary_genre_name,
           CASE WHEN x.release_date IS NULL THEN NULL ELSE x.release_date::timestamptz END,
           x.rating_count, x.average_rating, $2::timestamptz, $2::timestamptz, $3::boolean, NOW(), NOW()
         FROM jsonb_to_recordset($1::jsonb) AS x(
           app_id text,
           name text,
           artist text,
           icon_url text,
           store_url text,
           primary_genre_name text,
           release_date text,
           rating_count bigint,
           average_rating numeric
         )
         ON CONFLICT (app_id) DO UPDATE
         SET name = EXCLUDED.name,
             artist = COALESCE(EXCLUDED.artist, app_chart_apps.artist),
             icon_url = COALESCE(EXCLUDED.icon_url, app_chart_apps.icon_url),
             store_url = COALESCE(EXCLUDED.store_url, app_chart_apps.store_url),
             primary_genre_name = COALESCE(EXCLUDED.primary_genre_name, app_chart_apps.primary_genre_name),
             release_date = COALESCE(EXCLUDED.release_date, app_chart_apps.release_date),
             rating_count = COALESCE(EXCLUDED.rating_count, app_chart_apps.rating_count),
             average_rating = COALESCE(EXCLUDED.average_rating, app_chart_apps.average_rating),
             last_seen_at = GREATEST(app_chart_apps.last_seen_at, EXCLUDED.last_seen_at),
             updated_at = NOW()`,
        [appPayload, input.capturedAt, baseline]
      )

      const snapshotPayload = JSON.stringify(input.entries.map((entry) => ({ app_id: entry.appId, rank: entry.rank })))
      const snapshotResult = await client.query(
        `INSERT INTO app_chart_snapshots(country, chart, genre, app_id, rank, captured_at, source_updated_at, created_at)
         SELECT $1, $2, $3, x.app_id, x.rank, $4::timestamptz, $5::timestamptz, NOW()
         FROM jsonb_to_recordset($6::jsonb) AS x(app_id text, rank integer)
         ON CONFLICT (country, chart, genre, app_id, captured_at) DO UPDATE
         SET rank = EXCLUDED.rank,
             source_updated_at = COALESCE(EXCLUDED.source_updated_at, app_chart_snapshots.source_updated_at)`,
        [input.country, input.chart, input.genre, input.capturedAt, input.sourceUpdatedAt ?? input.capturedAt, snapshotPayload]
      )

      const termOrigins = new Map<string, { displayTerm: string; appId: string }>()
      const appTerms: Array<{ app_id: string; term: string }> = []
      for (const entry of input.entries) {
        for (const item of entry.terms) {
          if (!termOrigins.has(item.term)) termOrigins.set(item.term, { displayTerm: item.displayTerm, appId: entry.appId })
          appTerms.push({ app_id: entry.appId, term: item.term })
        }
      }

      let insertedTermNames: string[] = []
      if (termOrigins.size > 0) {
        const termPayload = JSON.stringify(Array.from(termOrigins, ([term, origin]) => ({
          term,
          display_term: origin.displayTerm,
          first_app_id: origin.appId
        })))
        const termResult = await client.query<{ term: string }>(
          `INSERT INTO app_chart_terms(term, display_term, first_seen_at, first_app_id, is_baseline, created_at)
           SELECT x.term, x.display_term, $2::timestamptz, x.first_app_id, $3::boolean, NOW()
           FROM jsonb_to_recordset($1::jsonb) AS x(term text, display_term text, first_app_id text)
           ON CONFLICT (term) DO NOTHING
           RETURNING term`,
          [termPayload, input.capturedAt, baseline]
        )
        insertedTermNames = termResult.rows.map((row) => row.term)
      }

      if (appTerms.length > 0) {
        const appTermPayload = JSON.stringify(appTerms)
        await client.query(
          `INSERT INTO app_chart_app_terms(app_id, term, first_seen_at, is_new_signal)
           SELECT x.app_id, x.term, $2::timestamptz,
                  (NOT $3::boolean AND x.term = ANY($4::text[]))
           FROM jsonb_to_recordset($1::jsonb) AS x(app_id text, term text)
           ON CONFLICT (app_id, term) DO UPDATE
           SET is_new_signal = app_chart_app_terms.is_new_signal OR EXCLUDED.is_new_signal`,
          [appTermPayload, input.capturedAt, baseline, insertedTermNames]
        )
      }

      await client.query("COMMIT")

      const newTerms = baseline || insertedTermNames.length === 0
        ? []
        : Array.from(termOrigins.entries())
            .filter(([term]) => insertedTermNames.includes(term))
            .map(([term, origin]) => ({
              term,
              displayTerm: origin.displayTerm,
              firstSeenAt: input.capturedAt,
              firstAppId: origin.appId,
              appName: input.entries.find((entry) => entry.appId === origin.appId)?.name
            }))

      return {
        baseline,
        insertedRanks: snapshotResult.rowCount ?? input.entries.length,
        newApps: baseline ? [] : newApps,
        newTerms
      }
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally {
      client.release()
    }
  }

  async listChart(options: {
    country: string
    chart: string
    genre: string
    sort?: AppChartSort
    newAppsOnly?: boolean
    newTermsOnly?: boolean
    limit?: number
  }): Promise<AppChartEntrySummary[]> {
    const sort = options.sort ?? "rising"
    const limit = Math.max(1, Math.min(200, options.limit ?? 100))
    const result = await this.db.query(
      `WITH latest AS (
         SELECT MAX(captured_at) AS captured_at
         FROM app_chart_snapshots
         WHERE country = $1 AND chart = $2 AND genre = $3
       ), current_chart AS (
         SELECT s.*
         FROM app_chart_snapshots s
         JOIN latest l ON l.captured_at = s.captured_at
         WHERE s.country = $1 AND s.chart = $2 AND s.genre = $3
       )
       SELECT
         c.app_id,
         c.rank,
         c.captured_at,
         prev.rank AS previous_rank,
         old.rank AS rank_24h_ago,
         a.name,
         a.artist,
         a.icon_url,
         a.store_url,
         a.primary_genre_name,
         a.release_date,
         a.rating_count,
         a.average_rating,
         a.first_seen_at,
         a.last_seen_at,
         a.is_baseline,
         (a.is_baseline = FALSE AND a.first_seen_at >= c.captured_at - INTERVAL '7 days') AS is_new_app,
         ARRAY(
           SELECT t.display_term
           FROM app_chart_app_terms at
           JOIN app_chart_terms t ON t.term = at.term
           WHERE at.app_id = c.app_id
             AND at.is_new_signal = TRUE
             AND t.first_seen_at >= c.captured_at - INTERVAL '7 days'
           ORDER BY t.first_seen_at DESC, t.display_term
         ) AS new_terms
       FROM current_chart c
       JOIN app_chart_apps a ON a.app_id = c.app_id
       LEFT JOIN LATERAL (
         SELECT s2.rank
         FROM app_chart_snapshots s2
         WHERE s2.country = c.country
           AND s2.chart = c.chart
           AND s2.genre = c.genre
           AND s2.app_id = c.app_id
           AND s2.captured_at < c.captured_at
         ORDER BY s2.captured_at DESC
         LIMIT 1
       ) prev ON TRUE
       LEFT JOIN LATERAL (
         SELECT s3.rank
         FROM app_chart_snapshots s3
         WHERE s3.country = c.country
           AND s3.chart = c.chart
           AND s3.genre = c.genre
           AND s3.app_id = c.app_id
           AND s3.captured_at <= c.captured_at - INTERVAL '18 hours'
         ORDER BY s3.captured_at DESC
         LIMIT 1
       ) old ON TRUE
       WHERE ($4::boolean = FALSE OR (a.is_baseline = FALSE AND a.first_seen_at >= c.captured_at - INTERVAL '7 days'))
         AND ($5::boolean = FALSE OR EXISTS (
           SELECT 1
           FROM app_chart_app_terms at2
           JOIN app_chart_terms t2 ON t2.term = at2.term
           WHERE at2.app_id = c.app_id
             AND at2.is_new_signal = TRUE
             AND t2.first_seen_at >= c.captured_at - INTERVAL '7 days'
         ))
       ORDER BY
         CASE WHEN $6 = 'rising' THEN GREATEST(
           COALESCE(old.rank - c.rank, -9999),
           COALESCE(prev.rank - c.rank, -9999)
         ) END DESC NULLS LAST,
         CASE WHEN $6 = 'new' THEN a.first_seen_at END DESC NULLS LAST,
         c.rank ASC
       LIMIT $7`,
      [options.country, options.chart, options.genre, options.newAppsOnly ?? false, options.newTermsOnly ?? false, sort, limit]
    )
    return result.rows.map((row) => toEntry(row as Record<string, unknown>))
  }

  async listNewTerms(options: { since?: Date; limit?: number } = {}): Promise<AppChartNewTerm[]> {
    const since = options.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const limit = Math.max(1, Math.min(200, options.limit ?? 50))
    const result = await this.db.query(
      `SELECT t.term, t.display_term, t.first_seen_at, t.first_app_id, a.name AS app_name
       FROM app_chart_terms t
       LEFT JOIN app_chart_apps a ON a.app_id = t.first_app_id
       WHERE t.is_baseline = FALSE
         AND t.first_seen_at >= $1
       ORDER BY t.first_seen_at DESC
       LIMIT $2`,
      [since, limit]
    )
    return result.rows.map((row) => ({
      term: String(row.term),
      displayTerm: String(row.display_term),
      firstSeenAt: String(row.first_seen_at),
      firstAppId: optionalString(row.first_app_id),
      appName: optionalString(row.app_name)
    }))
  }
}
