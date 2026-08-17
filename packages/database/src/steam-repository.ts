import type { Database } from "./client.js"

export type SteamStoreStatus = "unknown" | "coming_soon" | "released" | "unavailable"
export type SteamCcuSource = "game" | "demo" | "playtest"

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

export interface SteamGameSummary {
  appid: number
  name: string
  appType?: string
  firstObservedAt: string
  isBaseline: boolean
  steamLastModifiedAt?: string
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
  ccuSource?: SteamCcuSource
  ccuAppid?: number
  ccuCurrent?: number
  ccu24hPeak?: number
  ccu7dPeak?: number
  ccu24hGrowthPct?: number
  lastStoreCheckedAt?: string
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

function toGame(row: Record<string, unknown>): SteamGameSummary {
  return {
    appid: Number(row.appid),
    name: String(row.name),
    appType: optionalString(row.app_type),
    firstObservedAt: String(row.first_observed_at),
    isBaseline: Boolean(row.is_baseline),
    steamLastModifiedAt: optionalString(row.steam_last_modified_at),
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
    ccuSource: optionalString(row.ccu_source) as SteamCcuSource | undefined,
    ccuAppid: optionalNumber(row.ccu_appid),
    ccuCurrent: optionalNumber(row.ccu_current),
    ccu24hPeak: optionalNumber(row.ccu_24h_peak),
    ccu7dPeak: optionalNumber(row.ccu_7d_peak),
    ccu24hGrowthPct: optionalNumber(row.ccu_24h_growth_pct),
    lastStoreCheckedAt: optionalString(row.last_store_checked_at),
    lastCcuCheckedAt: optionalString(row.last_ccu_checked_at)
  }
}

export class SteamRepository {
  constructor(private readonly db: Database) {}

  async getState<T>(key: string): Promise<T | undefined> {
    const result = await this.db.query<{ value: T }>(
      `SELECT value FROM steam_monitor_state WHERE key = $1`,
      [key]
    )
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

    const appids = items.map((item) => item.appid)
    const existing = await this.db.query<{ appid: string }>(
      `SELECT appid FROM steam_games WHERE appid = ANY($1::bigint[])`,
      [appids]
    )
    const existingIds = new Set(existing.rows.map((row) => Number(row.appid)))
    const missing = items.filter((item) => !existingIds.has(item.appid))
    if (missing.length === 0) return { inserted: 0, updated: 0 }

    await this.db.query(
      `INSERT INTO steam_games(
         appid, name, first_observed_at, is_baseline, steam_last_modified_at,
         price_change_number, store_url, created_at, updated_at
       )
       SELECT
         x.appid,
         x.name,
         NOW(),
         $2::boolean,
         CASE WHEN x.last_modified IS NULL THEN NULL ELSE to_timestamp(x.last_modified) END,
         x.price_change_number,
         'https://store.steampowered.com/app/' || x.appid::text || '/',
         NOW(),
         NOW()
       FROM jsonb_to_recordset($1::jsonb) AS x(
         appid bigint,
         name text,
         last_modified bigint,
         price_change_number bigint
       )
       ON CONFLICT (appid) DO NOTHING`,
      [JSON.stringify(missing.map((item) => ({
        appid: item.appid,
        name: item.name,
        last_modified: item.lastModified ?? null,
        price_change_number: item.priceChangeNumber ?? null
      }))), isBaseline]
    )

    return { inserted: missing.length, updated: 0 }
  }

  async listForStoreCheck(limit = 200): Promise<SteamGameSummary[]> {
    const result = await this.db.query(
      `SELECT *
       FROM steam_games
       WHERE is_baseline = FALSE
         AND (app_type IS NULL OR app_type = 'game')
         AND (
           last_store_checked_at IS NULL
           OR (store_status IN ('unknown', 'coming_soon', 'unavailable') AND last_store_checked_at < NOW() - INTERVAL '12 hours')
           OR (store_status = 'released' AND last_store_checked_at < NOW() - INTERVAL '7 days')
         )
       ORDER BY last_store_checked_at ASC NULLS FIRST, first_observed_at DESC
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
           store_status = $4,
           store_url = $5,
           release_date_text = $6,
           release_date = $7::date,
           released_at = CASE
             WHEN $4 = 'released' AND released_at IS NULL THEN NOW()
             ELSE released_at
           END,
           has_demo = has_demo OR $8,
           demo_appid = COALESCE($9, demo_appid),
           demo_seen_at = CASE
             WHEN $8 = TRUE AND demo_seen_at IS NULL THEN NOW()
             ELSE demo_seen_at
           END,
           has_playtest = has_playtest OR $10,
           playtest_appid = COALESCE($11, playtest_appid),
           playtest_seen_at = CASE
             WHEN $10 = TRUE AND playtest_seen_at IS NULL THEN NOW()
             ELSE playtest_seen_at
           END,
           last_store_checked_at = NOW(),
           updated_at = NOW()
       WHERE appid = $1`,
      [
        appid,
        details.name ?? null,
        details.appType ?? null,
        details.status,
        details.storeUrl,
        details.releaseDateText ?? null,
        details.releaseDate ?? null,
        details.hasDemo,
        details.demoAppid ?? null,
        details.hasPlaytest,
        details.playtestAppid ?? null
      ]
    )
  }

  async markStoreCheckFailed(appid: number): Promise<void> {
    await this.db.query(
      `UPDATE steam_games SET last_store_checked_at = NOW(), updated_at = NOW() WHERE appid = $1`,
      [appid]
    )
  }

  async listForCcuCheck(limit = 300): Promise<SteamGameSummary[]> {
    const result = await this.db.query(
      `SELECT *
       FROM steam_games
       WHERE is_baseline = FALSE
         AND app_type = 'game'
         AND (store_status = 'released' OR has_demo = TRUE OR has_playtest = TRUE)
         AND (last_ccu_checked_at IS NULL OR last_ccu_checked_at < NOW() - INTERVAL '2 hours')
       ORDER BY last_ccu_checked_at ASC NULLS FIRST, first_observed_at DESC
       LIMIT $1`,
      [limit]
    )
    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }

  async recordCcu(appid: number, samples: SteamCcuSample[]): Promise<void> {
    if (samples.length === 0) {
      await this.db.query(
        `UPDATE steam_games SET last_ccu_checked_at = NOW(), updated_at = NOW() WHERE appid = $1`,
        [appid]
      )
      return
    }

    await this.db.query(
      `INSERT INTO steam_game_snapshots(appid, source_appid, source_type, ccu, recorded_at)
       SELECT $1, x.source_appid, x.source_type, x.ccu, NOW()
       FROM jsonb_to_recordset($2::jsonb) AS x(source_appid bigint, source_type text, ccu int)`,
      [appid, JSON.stringify(samples.map((sample) => ({
        source_appid: sample.sourceAppid,
        source_type: sample.sourceType,
        ccu: sample.ccu
      })))]
    )

    const current = samples.reduce((best, sample) => sample.ccu > best.ccu ? sample : best, samples[0]!)
    await this.db.query(
      `UPDATE steam_games
       SET ccu_source = $2,
           ccu_appid = $3,
           ccu_current = $4,
           ccu_24h_peak = (
             SELECT MAX(ccu) FROM steam_game_snapshots
             WHERE appid = $1 AND recorded_at >= NOW() - INTERVAL '24 hours'
           ),
           ccu_7d_peak = (
             SELECT MAX(ccu) FROM steam_game_snapshots
             WHERE appid = $1 AND recorded_at >= NOW() - INTERVAL '7 days'
           ),
           last_ccu_checked_at = NOW(),
           updated_at = NOW()
       WHERE appid = $1`,
      [appid, current.sourceType, current.sourceAppid, current.ccu]
    )
  }

  async listGames(options: {
    since?: Date
    status?: string
    minCcu?: number
    includeBaseline?: boolean
    sort?: "recent" | "ccu" | "growth"
    limit?: number
  } = {}): Promise<SteamGameSummary[]> {
    const conditions: string[] = ["g.app_type = 'game'"]
    const params: unknown[] = []
    const add = (condition: string, value: unknown): void => {
      params.push(value)
      conditions.push(condition.replace("?", `$${params.length}`))
    }

    if (!options.includeBaseline) conditions.push("g.is_baseline = FALSE")
    if (options.since) add("g.first_observed_at >= ?", options.since)
    if (options.status === "demo") conditions.push("g.has_demo = TRUE")
    else if (options.status === "playtest") conditions.push("g.has_playtest = TRUE")
    else if (options.status) add("g.store_status = ?", options.status)
    if (options.minCcu != null) add("COALESCE(g.ccu_current, 0) >= ?", options.minCcu)

    const limit = Math.min(Math.max(options.limit ?? 250, 1), 500)
    params.push(limit)
    const limitParam = `$${params.length}`
    const where = `WHERE ${conditions.join(" AND ")}`
    const orderBy = options.sort === "ccu"
      ? "g.ccu_current DESC NULLS LAST, g.first_observed_at DESC"
      : options.sort === "growth"
        ? "ccu_24h_growth_pct DESC NULLS LAST, g.first_observed_at DESC"
        : "g.first_observed_at DESC"

    const result = await this.db.query(
      `SELECT
         g.*,
         CASE
           WHEN previous.ccu IS NULL OR previous.ccu <= 0 OR g.ccu_current IS NULL THEN NULL
           ELSE ROUND(((g.ccu_current - previous.ccu)::numeric / previous.ccu::numeric) * 100, 1)::float
         END AS ccu_24h_growth_pct
       FROM steam_games g
       LEFT JOIN LATERAL (
         SELECT s.ccu
         FROM steam_game_snapshots s
         WHERE s.appid = g.appid
           AND s.recorded_at <= NOW() - INTERVAL '18 hours'
           AND s.recorded_at >= NOW() - INTERVAL '36 hours'
         ORDER BY s.recorded_at DESC
         LIMIT 1
       ) previous ON TRUE
       ${where}
       ORDER BY ${orderBy}
       LIMIT ${limitParam}`,
      params
    )

    return result.rows.map((row) => toGame(row as Record<string, unknown>))
  }
}
