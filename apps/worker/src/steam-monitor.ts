import {
  Database,
  SteamRepository,
  type SteamAppListItem,
  type SteamCcuSample,
  type SteamFollowerSample,
  type SteamGameSummary,
  type SteamStoreDetails
} from "@factory/database"

const APP_LIST_STATE_KEY = "steam_store_service_v1"
const LEGACY_MIRROR_STATE_KEY = "steam_games_mirror_v1"
const DEFAULT_APP_LIST_URL = "https://api.steampowered.com/IStoreService/GetAppList/v1/"
const DEFAULT_FIRST_SYNC_LOOKBACK_SECONDS = 7 * 24 * 60 * 60
const STORE_CHECK_LIMIT = Number(process.env.STEAM_STORE_CHECK_LIMIT ?? "200")
const FOLLOWER_CHECK_LIMIT = Number(process.env.STEAM_FOLLOWER_CHECK_LIMIT ?? "300")
const CCU_CHECK_LIMIT = Number(process.env.STEAM_CCU_CHECK_LIMIT ?? "300")
const USER_AGENT = "auto-site-factory/0.1"

interface AppListState {
  initializedAt?: string
  lastSyncAt?: string
  ifModifiedSince?: number
}

interface LegacyMirrorState {
  initializedAt?: string
  lastSyncAt?: string
}

interface SteamStoreApp {
  appid?: number
  name?: string
  last_modified?: number
  price_change_number?: number
}

interface SteamAppListResponse {
  response?: {
    apps?: SteamStoreApp[]
    have_more_results?: boolean
    last_appid?: number
  }
}

interface SteamAppDetailsResponse {
  success?: boolean
  data?: {
    type?: string
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

function requireSteamApiKey(): string {
  const key = process.env.STEAM_WEB_API_KEY?.trim()
  if (!key) throw new Error("Missing required environment variable: STEAM_WEB_API_KEY")
  return key
}

function firstSyncLookbackSeconds(): number {
  const configured = Number(process.env.STEAM_APP_LIST_FIRST_SYNC_LOOKBACK_SECONDS ?? DEFAULT_FIRST_SYNC_LOOKBACK_SECONDS)
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : DEFAULT_FIRST_SYNC_LOOKBACK_SECONDS
}

async function fetchAppListPage(options: {
  key: string
  ifModifiedSince?: number
  lastAppid?: number
}): Promise<{ items: SteamAppListItem[]; haveMore: boolean; lastAppid?: number }> {
  const endpoint = process.env.STEAM_APP_LIST_URL?.trim() || DEFAULT_APP_LIST_URL
  const url = new URL(endpoint)
  url.searchParams.set("key", options.key)
  url.searchParams.set("include_games", "true")
  url.searchParams.set("include_dlc", "false")
  url.searchParams.set("include_software", "false")
  url.searchParams.set("include_videos", "false")
  url.searchParams.set("include_hardware", "false")
  url.searchParams.set("max_results", "50000")
  if (options.ifModifiedSince != null) url.searchParams.set("if_modified_since", String(options.ifModifiedSince))
  if (options.lastAppid != null) url.searchParams.set("last_appid", String(options.lastAppid))

  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } })
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500)
    throw new Error(`Steam IStoreService/GetAppList failed (${response.status}): ${body}`)
  }

  const payload = await response.json() as SteamAppListResponse
  if (!payload.response) throw new Error("Steam IStoreService/GetAppList returned an invalid response")

  const items = (payload.response.apps ?? [])
    .filter((item): item is SteamStoreApp & { appid: number; name: string } =>
      typeof item.appid === "number" && item.appid > 0 && typeof item.name === "string" && Boolean(item.name.trim())
    )
    .map((item) => ({
      appid: item.appid,
      name: item.name.trim(),
      lastModified: item.last_modified,
      priceChangeNumber: item.price_change_number
    }))

  const responseLastAppid = Number(payload.response.last_appid)
  return {
    items,
    haveMore: payload.response.have_more_results === true,
    lastAppid: Number.isFinite(responseLastAppid) && responseLastAppid > 0
      ? responseLastAppid
      : items.at(-1)?.appid
  }
}

async function syncAppList(repository: SteamRepository): Promise<void> {
  const key = requireSteamApiKey()
  const state = await repository.getState<AppListState>(APP_LIST_STATE_KEY)
  const legacyState = state?.initializedAt
    ? undefined
    : await repository.getState<LegacyMirrorState>(LEGACY_MIRROR_STATE_KEY)

  const syncStartedAt = Math.floor(Date.now() / 1000)
  const hasExistingBaseline = Boolean(legacyState?.initializedAt)
  const baseline = !state?.initializedAt && !hasExistingBaseline
  const ifModifiedSince = baseline
    ? undefined
    : state?.ifModifiedSince ?? Math.max(0, syncStartedAt - firstSyncLookbackSeconds())

  let lastAppid: number | undefined
  let pages = 0
  let fetched = 0
  let inserted = 0

  while (true) {
    const page = await fetchAppListPage({ key, ifModifiedSince, lastAppid })
    pages += 1
    fetched += page.items.length

    for (const batch of chunks(page.items, 2000)) {
      const result = await repository.upsertAppList(batch, baseline)
      inserted += result.inserted
    }

    if (!page.haveMore) break

    const nextLastAppid = page.lastAppid
    if (!nextLastAppid || nextLastAppid === lastAppid) {
      throw new Error("Steam IStoreService/GetAppList pagination did not advance")
    }
    lastAppid = nextLastAppid

    if (pages >= 100) throw new Error("Steam IStoreService/GetAppList exceeded 100 pages")
  }

  await repository.setState(APP_LIST_STATE_KEY, {
    initializedAt: state?.initializedAt ?? new Date().toISOString(),
    lastSyncAt: new Date().toISOString(),
    ifModifiedSince: Math.max(0, syncStartedAt - 60)
  } satisfies AppListState)

  console.log(
    `[steam] app list source=IStoreService baseline=${baseline} since=${ifModifiedSince ?? "full"} pages=${pages} fetched=${fetched} new=${inserted}`
  )
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

  const response = await fetch(appDetailsUrl, { headers: { "user-agent": USER_AGENT } })
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

  const appType = entry.data.type?.trim().toLowerCase() || undefined
  if (appType && appType !== "game") {
    return {
      name: entry.data.name,
      appType,
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
    const page = await fetch(`${storeUrl}?l=english&cc=us`, { headers: { "user-agent": USER_AGENT } })
    if (page.ok) playtest = detectPlaytest(await page.text(), game.appid)
  } catch (error) {
    console.warn(`[steam] playtest page check failed appid=${game.appid}`, error)
  }

  return {
    name: entry.data.name,
    appType: appType ?? "game",
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

function parseFollowersFromStore(html: string): number | undefined {
  const match = html.match(/class=["'][^"']*num_followers[^"']*["'][^>]*>\s*([\d,]+)\s*</i)
  if (!match?.[1]) return undefined
  const value = Number(match[1].replaceAll(",", ""))
  return Number.isFinite(value) && value >= 0 ? value : undefined
}

function parseCommunityGroupId(html: string): string | undefined {
  return html.match(/OpenGroupChat\(\s*['"](\d+)['"]\s*\)/i)?.[1]
    ?? html.match(/steamid[_-]?group[^\d]{0,30}(\d{16,20})/i)?.[1]
}

function parseFollowersFromCommunityXml(xml: string): number | undefined {
  const values = [...xml.matchAll(/<memberCount>([\d,]+)<\/memberCount>/gi)]
    .map((match) => Number(match[1]?.replaceAll(",", "")))
    .filter((value) => Number.isFinite(value) && value >= 0)
  return values.at(-1)
}

async function fetchFollowers(appid: number): Promise<SteamFollowerSample | undefined> {
  const dlcUrl = `https://store.steampowered.com/dlc/${appid}/?l=english&cc=us`
  const dlcPage = await fetch(dlcUrl, { headers: { "user-agent": USER_AGENT }, redirect: "follow" })
  if (dlcPage.ok) {
    const followers = parseFollowersFromStore(await dlcPage.text())
    if (followers != null) return { followers, source: "store_dlc" }
  }

  const communityPage = await fetch(`https://steamcommunity.com/app/${appid}/`, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow"
  })
  if (!communityPage.ok) return undefined
  const groupId = parseCommunityGroupId(await communityPage.text())
  if (!groupId) return undefined

  const xmlPage = await fetch(`https://steamcommunity.com/gid/${groupId}/memberslistxml/?xml=1`, {
    headers: { "user-agent": USER_AGENT },
    redirect: "follow"
  })
  if (!xmlPage.ok) return undefined
  const followers = parseFollowersFromCommunityXml(await xmlPage.text())
  return followers == null ? undefined : { followers, source: "community_xml" }
}

async function refreshFollowers(repository: SteamRepository): Promise<void> {
  const games = await repository.listForFollowerCheck(FOLLOWER_CHECK_LIMIT)
  let sampled = 0
  let store = 0
  let fallback = 0
  let missing = 0

  await mapLimit(games, 5, async (game) => {
    try {
      const sample = await fetchFollowers(game.appid)
      await repository.recordFollowers(game.appid, sample)
      if (!sample) missing += 1
      else {
        sampled += 1
        if (sample.source === "store_dlc") store += 1
        else fallback += 1
      }
      await sleep(100)
    } catch (error) {
      missing += 1
      await repository.recordFollowers(game.appid)
      console.warn(`[steam] follower check failed appid=${game.appid}`, error)
    }
  })

  console.log(`[steam] followers games=${games.length} sampled=${sampled} store=${store} fallback=${fallback} missing=${missing}`)
}

async function fetchCcu(appid: number): Promise<number | undefined> {
  const url = new URL("https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/")
  url.searchParams.set("appid", String(appid))
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } })
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
  const db = new Database()
  const repository = new SteamRepository(db)
  try {
    await syncAppList(repository)
    await refreshStoreMetadata(repository)
    await refreshFollowers(repository)
    await refreshCcu(repository)
  } finally {
    await db.close()
  }
}

await runSteamMonitorOnce()
