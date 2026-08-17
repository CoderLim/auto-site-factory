import {
  Database,
  SteamRepository,
  type SteamAppListItem,
  type SteamCcuSample,
  type SteamGameSummary,
  type SteamStoreDetails
} from "@factory/database"

const APP_LIST_STATE_KEY = "steam_app_list_sync"
const STORE_CHECK_LIMIT = Number(process.env.STEAM_STORE_CHECK_LIMIT ?? "200")
const CCU_CHECK_LIMIT = Number(process.env.STEAM_CCU_CHECK_LIMIT ?? "300")

interface AppListState {
  initializedAt?: string
  lastSyncUnix?: number
}

interface SteamAppListResponse {
  response?: {
    apps?: Array<{
      appid: number
      name: string
      last_modified?: number
      price_change_number?: number
    }>
    have_more_results?: boolean
    last_appid?: number
  }
}

interface SteamAppDetailsResponse {
  success?: boolean
  data?: {
    name?: string
    steam_appid?: number
    release_date?: { coming_soon?: boolean; date?: string }
    demos?: Array<{ appid?: number; description?: string }>
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
  return result
}

async function mapLimit<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      await task(items[index]!)
    }
  })
  await Promise.all(workers)
}

function parseReleaseDate(value?: string): string | undefined {
  const text = value?.trim()
  if (!text || /^(coming soon|to be announced|tba|tbd)$/i.test(text)) return undefined
  const time = Date.parse(text)
  if (!Number.isFinite(time)) return undefined
  return new Date(time).toISOString().slice(0, 10)
}

async function fetchAppListPage(
  apiKey: string,
  options: { ifModifiedSince?: number; lastAppid?: number }
): Promise<SteamAppListResponse["response"]> {
  const input: Record<string, unknown> = {
    include_games: true,
    include_dlc: false,
    include_software: false,
    include_videos: false,
    include_hardware: false,
    max_results: 50000
  }
  if (options.ifModifiedSince) input.if_modified_since = options.ifModifiedSince
  if (options.lastAppid) input.last_appid = options.lastAppid

  const url = new URL("https://partner.steam-api.com/IStoreService/GetAppList/v1/")
  url.searchParams.set("key", apiKey)
  url.searchParams.set("input_json", JSON.stringify(input))

  const response = await fetch(url, { headers: { "user-agent": "auto-site-factory/0.1" } })
  if (!response.ok) throw new Error(`Steam GetAppList failed (${response.status}): ${await response.text()}`)
  const payload = await response.json() as SteamAppListResponse
  return payload.response
}

async function syncAppList(repository: SteamRepository, apiKey: string): Promise<void> {
  const state = await repository.getState<AppListState>(APP_LIST_STATE_KEY)
  const baseline = !state?.initializedAt
  const syncStartedUnix = Math.floor(Date.now() / 1000)
  let lastAppid: number | undefined
  let fetched = 0
  let inserted = 0
  let updated = 0

  do {
    const page = await fetchAppListPage(apiKey, {
      ifModifiedSince: baseline ? undefined : state?.lastSyncUnix,
      lastAppid
    })
    const items: SteamAppListItem[] = (page?.apps ?? [])
      .filter((item) => item.appid > 0 && item.name?.trim())
      .map((item) => ({
        appid: item.appid,
        name: item.name.trim(),
        lastModified: item.last_modified,
        priceChangeNumber: item.price_change_number
      }))

    fetched += items.length
    for (const batch of chunks(items, 2000)) {
      const result = await repository.upsertAppList(batch, baseline)
      inserted += result.inserted
      updated += result.updated
    }

    lastAppid = page?.have_more_results ? page.last_appid : undefined
  } while (lastAppid)

  await repository.setState(APP_LIST_STATE_KEY, {
    initializedAt: state?.initializedAt ?? new Date().toISOString(),
    lastSyncUnix: syncStartedUnix
  } satisfies AppListState)

  console.log(`[steam] app list baseline=${baseline} fetched=${fetched} inserted=${inserted} updated=${updated}`)
}

function detectPlaytest(html: string, mainAppid: number): { hasPlaytest: boolean; playtestAppid?: number } {
  const hasPlaytest = /game_area_playtest|Join the [^<]{0,160} Playtest|Request Access/i.test(html)
  if (!hasPlaytest) return { hasPlaytest: false }

  const patterns = [
    /store\.steampowered\.com\/app\/(\d+)\/[^"'<>\s]*playtest/i,
    /playtest[\s\S]{0,300}?data-ds-appid=["'](\d+)["']/i,
    /data-ds-appid=["'](\d+)["'][\s\S]{0,300}?playtest/i
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    const appid = match?.[1] ? Number(match[1]) : undefined
    if (appid && appid !== mainAppid) return { hasPlaytest: true, playtestAppid: appid }
  }
  return { hasPlaytest: true }
}

async function fetchStoreDetails(game: SteamGameSummary): Promise<SteamStoreDetails> {
  const appDetailsUrl = new URL("https://store.steampowered.com/api/appdetails")
  appDetailsUrl.searchParams.set("appids", String(game.appid))
  appDetailsUrl.searchParams.set("cc", "us")
  appDetailsUrl.searchParams.set("l", "english")

  const response = await fetch(appDetailsUrl, { headers: { "user-agent": "auto-site-factory/0.1" } })
  if (!response.ok) throw new Error(`Steam appdetails ${game.appid} failed (${response.status})`)
  const payload = await response.json() as Record<string, SteamAppDetailsResponse>
  const entry = payload[String(game.appid)]
  const storeUrl = `https://store.steampowered.com/app/${game.appid}/`

  if (!entry?.success || !entry.data) {
    return {
      status: "unavailable",
      storeUrl,
      hasDemo: false,
      hasPlaytest: false
    }
  }

  const demoAppid = entry.data.demos?.map((demo) => demo.appid).find((appid): appid is number => typeof appid === "number")
  const releaseText = entry.data.release_date?.date?.trim() || undefined
  const status = entry.data.release_date?.coming_soon === true ? "coming_soon" : "released"

  let playtest = { hasPlaytest: false } as { hasPlaytest: boolean; playtestAppid?: number }
  try {
    const page = await fetch(`${storeUrl}?l=english&cc=us`, { headers: { "user-agent": "auto-site-factory/0.1" } })
    if (page.ok) playtest = detectPlaytest(await page.text(), game.appid)
  } catch (error) {
    console.warn(`[steam] playtest page check failed appid=${game.appid}`, error)
  }

  return {
    name: entry.data.name,
    status,
    storeUrl,
    releaseDateText: releaseText,
    releaseDate: parseReleaseDate(releaseText),
    hasDemo: Boolean(demoAppid),
    demoAppid,
    hasPlaytest: playtest.hasPlaytest,
    playtestAppid: playtest.playtestAppid
  }
}

async function refreshStoreMetadata(repository: SteamRepository): Promise<void> {
  const games = await repository.listForStoreCheck(STORE_CHECK_LIMIT)
  let success = 0
  let failed = 0

  await mapLimit(games, 5, async (game) => {
    try {
      const details = await fetchStoreDetails(game)
      await repository.updateStoreDetails(game.appid, details)
      success += 1
      await sleep(75)
    } catch (error) {
      failed += 1
      await repository.markStoreCheckFailed(game.appid)
      console.error(`[steam] store metadata failed appid=${game.appid}`, error)
    }
  })

  console.log(`[steam] store metadata checked=${games.length} success=${success} failed=${failed}`)
}

async function fetchCcu(appid: number): Promise<number | undefined> {
  const url = new URL("https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/")
  url.searchParams.set("appid", String(appid))
  const response = await fetch(url, { headers: { "user-agent": "auto-site-factory/0.1" } })
  if (!response.ok) return undefined
  const payload = await response.json() as { response?: { player_count?: number; result?: number } }
  const value = payload.response?.player_count
  return typeof value === "number" && value >= 0 ? value : undefined
}

function ccuTargets(game: SteamGameSummary): Array<{ sourceAppid: number; sourceType: SteamCcuSample["sourceType"] }> {
  if (game.storeStatus === "released") return [{ sourceAppid: game.appid, sourceType: "game" }]

  const targets: Array<{ sourceAppid: number; sourceType: SteamCcuSample["sourceType"] }> = []
  if (game.playtestAppid) targets.push({ sourceAppid: game.playtestAppid, sourceType: "playtest" })
  if (game.demoAppid) targets.push({ sourceAppid: game.demoAppid, sourceType: "demo" })
  return targets
}

async function refreshCcu(repository: SteamRepository): Promise<void> {
  const games = await repository.listForCcuCheck(CCU_CHECK_LIMIT)
  let sampled = 0

  await mapLimit(games, 10, async (game) => {
    const samples: SteamCcuSample[] = []
    for (const target of ccuTargets(game)) {
      const ccu = await fetchCcu(target.sourceAppid)
      if (ccu != null) samples.push({ ...target, ccu })
    }
    await repository.recordCcu(game.appid, samples)
    sampled += samples.length
  })

  console.log(`[steam] ccu games=${games.length} samples=${sampled}`)
}

export async function runSteamMonitorOnce(): Promise<void> {
  const apiKey = process.env.STEAM_WEB_API_KEY?.trim()
  if (!apiKey) throw new Error("STEAM_WEB_API_KEY is required for Steam discovery")

  const db = new Database()
  const repository = new SteamRepository(db)
  try {
    await syncAppList(repository, apiKey)
    await refreshStoreMetadata(repository)
    await refreshCcu(repository)
  } finally {
    await db.close()
  }
}

await runSteamMonitorOnce()
