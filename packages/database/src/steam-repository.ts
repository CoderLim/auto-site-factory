import type { Database } from "./client.js"

export type SteamStoreStatus = "unknown" | "coming_soon" | "released" | "unavailable"
export type SteamCcuSource = "game" | "demo" | "playtest"
export type SteamFollowerSource = "store_dlc" | "community_xml"
export type SteamOpportunityReason = "new_app" | "released" | "demo" | "playtest" | "ccu_spike" | "follower_spike" | "high_followers"

export interface SteamAppListItem {
  appid: number
  name: string
  lastModified?: number
  priceChangeNumber?: number
}

export interface SteamStoreDetails {
  name?: string
  appType?: string
  status: SteamStoreStatus
  storeUrl: string
  releaseDateText?: string
  releaseDate?: string
  hasDemo: boolean
  demoAppid?: number
  hasPlaytest: boolean
  playtestAppid?: number
}

export interface SteamCcuSample {
  sourceAppid: number
  sourceType: SteamCcuSource
  ccu: number
}

export interface SteamFollowerSample {
  followers: number
  source: SteamFollowerSource
}

export interface SteamFollowerTrendPoint {
  recordedAt: string
  followers: number
}

export interface SteamGameSummary {
  appid: number
  name: string
  appType?: string
  firstObservedAt: string
  isBaseline: boolean
  steamLastModifiedAt?: string
  appListChangedAt?: string
  opportunityAt?: string
  opportunityReason?: SteamOpportunityReason
  storeStatus: SteamStoreStatus
  storeUrl?: string
  releaseDateText?: string
  releaseDate?: string
  releasedAt?: string
  hasDemo: boolean
  demoAppid?: number
  demoSeenAt?: string
  hasPlaytest: boolean
  playtestAppid?: number
  playtestSeenAt?: string
  followersCurrent?: number
  followersSource?: SteamFollowerSource
  followers24hDelta?: number
  followers7dDelta?: number
  followers7dGrowthPct?: number
  followersTrend: SteamFollowerTrendPoint[]
  ccuSource?: SteamCcuSource
  ccuAppid?: number
  ccuCurrent?: number
  ccu24hPeak?: number
  ccu7dPeak?: number
  ccu24hGrowthPct?: number
  lastStoreCheckedAt?: string
  lastFollowerCheckedAt?: string
  lastCcuCheckedAt?: string
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

function optionalNumber(value: unknown): number | undefined {
  if (value == null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseFollowerTrend(value: unknown): SteamFollowerTrendPoint[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((point) => {
    if (!point || typeof point !== "object") return []
    const item = point as Record<string, unknown>
    const followers = Number(item.followers)
    const recordedAt = item.recordedAt == null ? "" : String(item.recordedAt)
    if (!Number.isFinite(followers) || followers < 0 || !recordedAt) return []
    return [{ followers, recordedAt }]
  })
}

function toGame(row: Record<string, unknown>): SteamGameSummary {
  return {
    appid: Number(row.appid),
    name: String(row.name),
    appType: optionalString(row.app_type),
    firstObservedAt: String(row.first_observed_at),
    isBaseline: Boolean(row.is_baseline),
    steamLastModifiedAt: optionalString(row.steam_last_modified_at),
    appListChangedAt: optionalString(row.app_list_changed_at),
    opportunityAt: optionalString(row.opportunity_at),
    opportunityReason: optionalString(row.opportunity_reason) as SteamOpportunityReason | undefined,
    storeStatus: String(row.store_status) as SteamStoreStatus,
    storeUrl: optionalString(row.store_url),
    releaseDateText: optionalString(row.release_date_text),
    releaseDate: optionalString(row.release_date),
    releasedAt: optionalString(row.released_at),
    hasDemo: Boolean(row.has_demo),
    demoAppid: optionalNumber(row.demo_appid),
    demoSeenAt: optionalString(row.demo_seen_at),
    hasPlaytest: Boolean(row.has_playtest),
    playtestAppid: optionalNumber(row.playtest_appid),
    playtestSeenAt: optionalString(row.playtest_seen_at),
    followersCurrent: optionalNumber(row.followers_current),
    followersSource: optionalString(row.followers_source) as SteamFollowerSource | undefined,
    followers24hDelta: optionalNumber(row.followers_24h_delta),
    followers7dDelta: optionalNumber(row.followers_7d_delta),
    followers7dGrowthPct: optionalNumber(row.followers_7d_growth_pct),
    followersTrend: parseFollowerTrend(row.follower_trend),
    ccuSource: optionalString(row.ccu_source) as SteamCcuSource | undefined,
    ccuAppid: optionalNumber(row.ccu_appid),
    ccuCurrent: optionalNumber(row.ccu_current),
    ccu24hPeak: optionalNumber(row.ccu_24h_peak),
    ccu7dPeak: optionalNumber(row.ccu_7d_peak),
    ccu24hGrowthPct: optionalNumber(row.ccu_24h_growth_pct),
    lastStoreCheckedAt: optionalString(row.last_store_checked_at),
    lastFollowerCheckedAt: optionalString(row.last_follower_checked_at),
    lastCcuCheckedAt: optionalString(row.last_ccu_checked_at)
  }
}

export class SteamRepository {
  constructor(private readonly db: Database) {}

  async getState<T>(key: string): Promise<T | undefined> {
    const result = await this.db.query<{ value: T }>(`SELECT value FROM steam_monitor_state WHERE key = $1`, [key])
    return result.rows[0]?.value
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.db.query(
      `INSERT INTO steam_monitor_state(key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)]
    )
  }

  async upsertAppList(items: SteamAppListItem[], isBaseline: boolean): Promise<{ inserted: number; updated: number }> {
    if (items.length === 0) return { inserted: 0, updated: 0 }

    const payload = JSON.stringify(items.map((item) => ({
      appid: item.appid,
      name: item.name,
      last_modified: item.lastModified ?? null,
      price_change_number: item.priceChangeNumber ?? null
    })))

    const existing = await this.db.query<{ appid: string }>(`SELECT appid FROM steam_games WHERE appid = ANY($1::bigint[])`, [items.map((item) => item.appid)])
    const existingIds = new Set(existing.rows.map((row) => Number(row.appid)))
    const inserted = items.filter((item) => !existingIds.has(item.appid)).length

    const result = await this.db.query<{ appid: string }>(
      `INSERT INTO steam_games(
         appid, name, app_type, first_observed_at, is_baseline, steam_last_modified_at,
         price_change_number, store_url, opportunity_at, opportunity_reason, created_at, updated_at
       )
       SELECT
         x.appid,
         x.name,
         'game',
         NOW(),
         $2::boolean,
         CASE WHEN x.last_modified IS NULL THEN NULL ELSE to_timestamp(x.last_modified) END,
         x.price_change_number,
         'https://store.steampowered.com/app/' || x.appid::text || '/',
         CASE WHEN $2::boolean THEN NULL ELSE NOW() END,
         CASE WHEN $2::boolean THEN NULL ELSE 'new_app' END,
         NOW(),
         NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         appid bigint,
         name text,
         last_modified bigint,
         price_change_number bigint
       )
       ON CONFLICT (appid) DO UPDATE
       SET name = EXCLUDED.name,
           steam_last_modified_at = CASE
             WHEN EXCLUDED.steam_last_modified_at IS NULL THEN steam_games.steam_last_modified_at
             ELSE GREATEST(steam_games.steam_last_modified_at, EXCLUDED.steam_last_modified_at)
           END,
           price_change_number = COALESCE(EXCLUDED.price_change_number, steam_games.price_change_number),
           app_list_changed_at = CASE
             WHEN (EXCLUDED.steam_last_modified_at IS NOT NULL AND (steam_games.steam_last_modified_at IS NULL OR EXCLUDED.steam_last_modified_at > steam_games.steam_last_modified_at))
               OR EXCLUDED.name IS DISTINCT FROM steam_games.name
               OR (EXCLUDED.price_change_number IS NOT NULL AND EXCLUDED.price_change_number IS DISTINCT FROM steam_games.price_change_number)
             THEN NOW()
             ELSE steam_games.app_list_changed_at
           END,
           updated_at = NOW()
       RETURNING appid`,
      [payload, isBaseline]
    )

    return { inserted, updated: Math.max(0, result.rows.length - inserted) }
  }

  async listForStoreCheck(limit = 200): Promise<SteamGameSummary[]> {
    const result = await this.db.query(
      `SELECT *
       FROM steam_games
       WHERE (app_type IS NULL OR app_type = 'game')
         AND (
           (is_baseline = FALSE AND (
             last_store_checked_at IS NULL
             OR (store_status IN ('unknown', 'coming_soon', 'unavailable') AND last_store_checked_at < NOW() - INTERVAL '12 hours')
             OR (store_status = 'released' AND last_store_checked_at < NOW() - INTERVAL '7 days')
           ))
           OR (app_list_changed_at IS NOT NULL AND (last_store_checked_at IS NULL OR app_list_changed_at > last_store_checked_at))
           OR (opportunity_at >= NOW() - INTERVAL '30 days' AND (last_store_checked_at IS NULL OR last_store_checked_at < NOW() - INTERVAL '12 hours'))
         )
       ORDER BY app_list_changed_at DESC NULLS LAST, last_store_checked_at ASC NULLS FIRST, first_observed_at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }

  async updateStoreDetails(appid: number, details: SteamStoreDetails): Promise<void> {
    await this.db.query(
      `UPDATE steam_games
       SET name = COALESCE($2, name),
           app_type = COALESCE($3, app_type),
           opportunity_at = CASE
             WHEN $4 = 'released' AND store_status <> 'released' THEN NOW()
             WHEN $8 = TRUE AND has_demo = FALSE THEN NOW()
             WHEN $10 = TRUE AND has_playtest = FALSE THEN NOW()
             ELSE opportunity_at
           END,
           opportunity_reason = CASE
             WHEN $4 = 'released' AND store_status <> 'released' THEN 'released'
             WHEN $8 = TRUE AND has_demo = FALSE THEN 'demo'
             WHEN $10 = TRUE AND has_playtest = FALSE THEN 'playtest'
             ELSE opportunity_reason
           END,
           store_status = $4,
           store_url = $5,
           release_date_text = $6,
           release_date = $7::date,
           released_at = CASE WHEN $4 = 'released' AND released_at IS NULL THEN NOW() ELSE released_at END,
           has_demo = has_demo OR $8,
           demo_appid = COALESCE($9, demo_appid),
           demo_seen_at = CASE WHEN $8 = TRUE AND demo_seen_at IS NULL THEN NOW() ELSE demo_seen_at END,
           has_playtest = has_playtest OR $10,
           playtest_appid = COALESCE($11, playtest_appid),
           playtest_seen_at = CASE WHEN $10 = TRUE AND playtest_seen_at IS NULL THEN NOW() ELSE playtest_seen_at END,
           last_store_checked_at = NOW(),
           updated_at = NOW()
       WHERE appid = $1`,
      [appid, details.name ?? null, details.appType ?? null, details.status, details.storeUrl, details.releaseDateText ?? null, details.releaseDate ?? null, details.hasDemo, details.demoAppid ?? null, details.hasPlaytest, details.playtestAppid ?? null]
    )
  }

  async markStoreCheckFailed(appid: number): Promise<void> {
    await this.db.query(`UPDATE steam_games SET last_store_checked_at = NOW(), updated_at = NOW() WHERE appid = $1`, [appid])
  }

  async listForFollowerCheck(limit = 300): Promise<SteamGameSummary[]> {
    const result = await this.db.query(
      `SELECT *
       FROM steam_games
       WHERE app_type = 'game'
         AND store_status <> 'unavailable'
         AND (
           is_baseline = FALSE
           OR opportunity_at >= NOW() - INTERVAL '30 days'
           OR has_playtest = TRUE
           OR has_demo = TRUE
           OR store_status = 'coming_soon'
           OR (release_date IS NOT NULL AND release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90)
         )
         AND (last_follower_checked_at IS NULL OR last_follower_checked_at < NOW() - INTERVAL '6 hours')
       ORDER BY
         CASE
           WHEN opportunity_at >= NOW() - INTERVAL '30 days' THEN 0
           WHEN has_playtest = TRUE THEN 1
           WHEN store_status = 'coming_soon' AND release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 90 THEN 2
           WHEN store_status = 'coming_soon' THEN 3
           WHEN has_demo = TRUE THEN 4
           ELSE 5
         END,
         last_follower_checked_at ASC NULLS FIRST,
         opportunity_at DESC NULLS LAST,
         first_observed_at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }

  async recordFollowers(appid: number, sample?: SteamFollowerSample): Promise<void> {
    if (!sample) {
      await this.db.query(`UPDATE steam_games SET last_follower_checked_at = NOW(), updated_at = NOW() WHERE appid = $1`, [appid])
      return
    }

    await this.db.query(`INSERT INTO steam_follower_snapshots(appid, followers, source, recorded_at) VALUES ($1, $2, $3, NOW())`, [appid, sample.followers, sample.source])
    await this.db.query(
      `UPDATE steam_games g
       SET followers_current = $2,
           followers_source = $3,
           opportunity_at = CASE
             WHEN g.followers_current IS NULL AND $2 >= 20000 THEN NOW()
             WHEN previous.followers > 0 AND $2 - previous.followers >= 50 AND (($2 - previous.followers)::numeric / previous.followers::numeric) >= 0.5 THEN NOW()
             ELSE g.opportunity_at
           END,
           opportunity_reason = CASE
             WHEN g.followers_current IS NULL AND $2 >= 20000 THEN 'high_followers'
             WHEN previous.followers > 0 AND $2 - previous.followers >= 50 AND (($2 - previous.followers)::numeric / previous.followers::numeric) >= 0.5 THEN 'follower_spike'
             ELSE g.opportunity_reason
           END,
           last_follower_checked_at = NOW(),
           updated_at = NOW()
       FROM (
         SELECT (
           SELECT s.followers
           FROM steam_follower_snapshots s
           WHERE s.appid = $1
             AND s.recorded_at <= NOW() - INTERVAL '6 days'
             AND s.recorded_at >= NOW() - INTERVAL '8 days'
           ORDER BY ABS(EXTRACT(EPOCH FROM (s.recorded_at - (NOW() - INTERVAL '7 days')))) ASC
           LIMIT 1
         ) AS followers
       ) previous
       WHERE g.appid = $1`,
      [appid, sample.followers, sample.source]
    )
  }

  async listForCcuCheck(limit = 300): Promise<SteamGameSummary[]> {
    const result = await this.db.query(
      `SELECT *
       FROM steam_games
       WHERE app_type = 'game'
         AND (is_baseline = FALSE OR opportunity_at >= NOW() - INTERVAL '30 days')
         AND (store_status = 'released' OR has_demo = TRUE OR has_playtest = TRUE)
         AND (last_ccu_checked_at IS NULL OR last_ccu_checked_at < NOW() - INTERVAL '2 hours')
       ORDER BY opportunity_at DESC NULLS LAST, last_ccu_checked_at ASC NULLS FIRST, first_observed_at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }

  async recordCcu(appid: number, samples: SteamCcuSample[]): Promise<void> {
    if (samples.length === 0) {
      await this.db.query(`UPDATE steam_games SET last_ccu_checked_at = NOW(), updated_at = NOW() WHERE appid = $1`, [appid])
      return
    }

    await this.db.query(
      `INSERT INTO steam_game_snapshots(appid, source_appid, source_type, ccu, recorded_at)
       SELECT $1, x.source_appid, x.source_type, x.ccu, NOW()
       FROM jsonb_to_recordset($2::jsonb) AS x(source_appid bigint, source_type text, ccu int)`,
      [appid, JSON.stringify(samples.map((sample) => ({ source_appid: sample.sourceAppid, source_type: sample.sourceType, ccu: sample.ccu })))]
    )

    const current = samples.reduce((best, sample) => sample.ccu > best.ccu ? sample : best, samples[0]!)
    await this.db.query(
      `UPDATE steam_games g
       SET ccu_source = $2,
           ccu_appid = $3,
           ccu_current = $4,
           ccu_24h_peak = (SELECT MAX(ccu) FROM steam_game_snapshots WHERE appid = $1 AND recorded_at >= NOW() - INTERVAL '24 hours'),
           ccu_7d_peak = (SELECT MAX(ccu) FROM steam_game_snapshots WHERE appid = $1 AND recorded_at >= NOW() - INTERVAL '7 days'),
           opportunity_at = CASE WHEN previous.ccu > 0 AND $4 >= 100 AND $4 >= previous.ccu * 2 THEN NOW() ELSE g.opportunity_at END,
           opportunity_reason = CASE WHEN previous.ccu > 0 AND $4 >= 100 AND $4 >= previous.ccu * 2 THEN 'ccu_spike' ELSE g.opportunity_reason END,
           last_ccu_checked_at = NOW(),
           updated_at = NOW()
       FROM (
         SELECT (
           SELECT s.ccu
           FROM steam_game_snapshots s
           WHERE s.appid = $1
             AND s.recorded_at <= NOW() - INTERVAL '18 hours'
             AND s.recorded_at >= NOW() - INTERVAL '36 hours'
           ORDER BY s.recorded_at DESC
           LIMIT 1
         ) AS ccu
       ) previous
       WHERE g.appid = $1`,
      [appid, current.sourceType, current.sourceAppid, current.ccu]
    )
  }

  async listGames(options: {
    since?: Date
    status?: string
    minCcu?: number
    includeBaseline?: boolean
    sort?: "recent" | "ccu" | "growth" | "followers" | "follower_growth"
    limit?: number
  } = {}): Promise<SteamGameSummary[]> {
    const conditions: string[] = ["g.app_type = 'game'"]
    const params: unknown[] = []
    const add = (condition: string, value: unknown): void => {
      params.push(value)
      conditions.push(condition.replace("?", `$${params.length}`))
    }

    if (!options.includeBaseline) conditions.push("(g.is_baseline = FALSE OR g.opportunity_at IS NOT NULL)")
    if (options.since) add("COALESCE(g.opportunity_at, CASE WHEN g.is_baseline = FALSE THEN g.first_observed_at END) >= ?", options.since)
    if (options.status === "demo") conditions.push("g.has_demo = TRUE")
    else if (options.status === "playtest") conditions.push("g.has_playtest = TRUE")
    else if (options.status) add("g.store_status = ?", options.status)
    if (options.minCcu != null) add("COALESCE(g.ccu_current, 0) >= ?", options.minCcu)

    const limit = Math.min(Math.max(options.limit ?? 250, 1), 500)
    params.push(limit)
    const limitParam = `$${params.length}`
    const where = `WHERE ${conditions.join(" AND ")}`
    const recentOrder = "COALESCE(g.opportunity_at, g.first_observed_at) DESC"
    const orderBy = options.sort === "ccu"
      ? `g.ccu_current DESC NULLS LAST, ${recentOrder}`
      : options.sort === "growth"
        ? `ccu_24h_growth_pct DESC NULLS LAST, ${recentOrder}`
        : options.sort === "followers"
          ? `g.followers_current DESC NULLS LAST, ${recentOrder}`
          : options.sort === "follower_growth"
            ? `followers_7d_delta DESC NULLS LAST, ${recentOrder}`
            : recentOrder

    const result = await this.db.query(
      `SELECT
         g.*,
         COALESCE(follower_trend.points, '[]'::jsonb) AS follower_trend,
         CASE WHEN previous_ccu.ccu IS NULL OR previous_ccu.ccu <= 0 OR g.ccu_current IS NULL THEN NULL ELSE ROUND(((g.ccu_current - previous_ccu.ccu)::numeric / previous_ccu.ccu::numeric) * 100, 1)::float END AS ccu_24h_growth_pct,
         CASE WHEN follower_24h.followers IS NULL OR g.followers_current IS NULL THEN NULL ELSE g.followers_current - follower_24h.followers END AS followers_24h_delta,
         CASE WHEN follower_7d.followers IS NULL OR g.followers_current IS NULL THEN NULL ELSE g.followers_current - follower_7d.followers END AS followers_7d_delta,
         CASE WHEN follower_7d.followers IS NULL OR follower_7d.followers <= 0 OR g.followers_current IS NULL THEN NULL ELSE ROUND(((g.followers_current - follower_7d.followers)::numeric / follower_7d.followers::numeric) * 100, 1)::float END AS followers_7d_growth_pct
       FROM steam_games g
       LEFT JOIN LATERAL (
         SELECT s.ccu FROM steam_game_snapshots s
         WHERE s.appid = g.appid AND s.recorded_at <= NOW() - INTERVAL '18 hours' AND s.recorded_at >= NOW() - INTERVAL '36 hours'
         ORDER BY s.recorded_at DESC LIMIT 1
       ) previous_ccu ON TRUE
       LEFT JOIN LATERAL (
         SELECT s.followers FROM steam_follower_snapshots s
         WHERE s.appid = g.appid AND s.recorded_at <= NOW() - INTERVAL '18 hours' AND s.recorded_at >= NOW() - INTERVAL '36 hours'
         ORDER BY ABS(EXTRACT(EPOCH FROM (s.recorded_at - (NOW() - INTERVAL '24 hours')))) ASC LIMIT 1
       ) follower_24h ON TRUE
       LEFT JOIN LATERAL (
         SELECT s.followers FROM steam_follower_snapshots s
         WHERE s.appid = g.appid AND s.recorded_at <= NOW() - INTERVAL '6 days' AND s.recorded_at >= NOW() - INTERVAL '8 days'
         ORDER BY ABS(EXTRACT(EPOCH FROM (s.recorded_at - (NOW() - INTERVAL '7 days')))) ASC LIMIT 1
       ) follower_7d ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('recordedAt', s.recorded_at, 'followers', s.followers) ORDER BY s.recorded_at) AS points
         FROM steam_follower_snapshots s
         WHERE s.appid = g.appid AND s.recorded_at >= NOW() - INTERVAL '7 days'
       ) follower_trend ON TRUE
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limitParam}`,
      params
    )

    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }
}
