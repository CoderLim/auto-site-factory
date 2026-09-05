import { AppChartRepository, Database, type AppChartEntryInput, type AppChartTermInput } from "@factory/database"

const DEFAULT_GENRES = ["all", "6007", "6002", "6008", "6027", "6017", "6012", "6014"]
const GETCHARTS_BASE_URL = process.env.APP_CHART_API_BASE_URL?.trim() || "https://getcharts.app"
const ITUNES_LOOKUP_BASE_URL = process.env.APP_CHART_LOOKUP_BASE_URL?.trim() || "https://itunes.apple.com/lookup"

const GENERIC_TERMS = new Set([
  "about", "after", "again", "also", "android", "apple", "apps", "best", "better", "chat", "daily",
  "easy", "editor", "free", "game", "games", "iphone", "ios", "live", "mobile", "official", "online",
  "photo", "photos", "plus", "premium", "social", "store", "tools", "tracker", "video", "videos", "with",
  "your", "from", "this", "that", "have", "more", "make", "play", "world", "smart", "pro"
])

interface ChartEntry {
  id: string
  rank: number
  name: string
  artist?: string
  icon?: string
}

interface ChartResponse {
  storefront?: string
  category?: string
  updatedAt?: string
  entries?: ChartEntry[]
}

interface LookupApp {
  trackId?: number
  trackName?: string
  sellerName?: string
  artistName?: string
  artworkUrl100?: string
  trackViewUrl?: string
  primaryGenreName?: string
  releaseDate?: string
  userRatingCount?: number
  userRatingCountForCurrentVersion?: number
  averageUserRating?: number
}

interface LookupResponse {
  resultCount?: number
  results?: LookupApp[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson<T>(url: string, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "auto-site-factory/1.0 app-chart-monitor"
        }
      })
      if (response.ok) return await response.json() as T

      const retryAfter = Number(response.headers.get("retry-after") ?? "0")
      if ((response.status === 429 || response.status >= 500) && attempt < attempts) {
        await sleep(retryAfter > 0 ? retryAfter * 1000 : attempt * 1500)
        continue
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`)
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 1000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
}

function extractTerms(name: string): AppChartTermInput[] {
  const matches = name.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []
  const seen = new Set<string>()
  const terms: AppChartTermInput[] = []
  for (const displayTerm of matches) {
    const term = normalizeTerm(displayTerm)
    if (seen.has(term)) continue
    if (/^\d+$/.test(term)) continue
    if (term.length < 4) continue
    if (GENERIC_TERMS.has(term)) continue
    seen.add(term)
    terms.push({ term, displayTerm })
  }
  return terms
}

async function fetchChart(country: string, chart: string, genre: string): Promise<ChartResponse> {
  const params = new URLSearchParams({ country: country.toLowerCase(), category: chart, genre, limit: "100" })
  return fetchJson<ChartResponse>(`${GETCHARTS_BASE_URL}/api/v1/apple/charts?${params}`)
}

async function fetchMetadata(country: string, appIds: string[]): Promise<Map<string, LookupApp>> {
  const result = new Map<string, LookupApp>()
  const chunkSize = 50
  for (let index = 0; index < appIds.length; index += chunkSize) {
    const chunk = appIds.slice(index, index + chunkSize)
    const params = new URLSearchParams({ country: country.toLowerCase(), entity: "software", id: chunk.join(",") })
    try {
      const response = await fetchJson<LookupResponse>(`${ITUNES_LOOKUP_BASE_URL}?${params}`)
      for (const app of response.results ?? []) {
        if (app.trackId == null) continue
        result.set(String(app.trackId), app)
      }
    } catch (error) {
      console.warn(`[app-charts] metadata lookup failed for ${chunk.length} apps`, error)
    }
  }
  return result
}

function toEntry(entry: ChartEntry, metadata?: LookupApp): AppChartEntryInput | undefined {
  const appId = String(entry.id ?? "").trim()
  const rank = Number(entry.rank)
  const name = String(entry.name ?? metadata?.trackName ?? "").trim()
  if (!appId || !Number.isFinite(rank) || rank <= 0 || !name) return undefined

  const ratingCount = metadata?.userRatingCount ?? metadata?.userRatingCountForCurrentVersion
  return {
    appId,
    rank,
    name,
    artist: entry.artist ?? metadata?.sellerName ?? metadata?.artistName,
    iconUrl: entry.icon ?? metadata?.artworkUrl100,
    storeUrl: metadata?.trackViewUrl ?? `https://apps.apple.com/us/app/id${encodeURIComponent(appId)}`,
    primaryGenreName: metadata?.primaryGenreName,
    releaseDate: metadata?.releaseDate,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : undefined,
    averageRating: Number.isFinite(metadata?.averageUserRating) ? metadata?.averageUserRating : undefined,
    terms: extractTerms(name)
  }
}

async function run(): Promise<void> {
  const country = (process.env.APP_CHART_COUNTRY?.trim() || "us").toLowerCase()
  const chart = process.env.APP_CHART_CHART?.trim() || "top-free"
  const genres = (process.env.APP_CHART_GENRES?.split(",").map((item) => item.trim()).filter(Boolean) ?? DEFAULT_GENRES)
  const db = new Database()
  const repository = new AppChartRepository(db)

  try {
    for (const genre of genres) {
      const chartResponse = await fetchChart(country, chart, genre)
      const chartEntries = Array.isArray(chartResponse.entries) ? chartResponse.entries : []
      if (chartEntries.length === 0) {
        console.warn(`[app-charts] empty chart country=${country} chart=${chart} genre=${genre}`)
        continue
      }

      const appIds = chartEntries.map((entry) => String(entry.id)).filter(Boolean)
      const metadata = await fetchMetadata(country, appIds)
      const entries = chartEntries.flatMap((entry) => {
        const normalized = toEntry(entry, metadata.get(String(entry.id)))
        return normalized ? [normalized] : []
      })
      const capturedAt = chartResponse.updatedAt && Number.isFinite(Date.parse(chartResponse.updatedAt))
        ? new Date(chartResponse.updatedAt).toISOString()
        : new Date().toISOString()

      const recorded = await repository.recordSnapshot({
        country,
        chart,
        genre,
        capturedAt,
        sourceUpdatedAt: chartResponse.updatedAt,
        entries
      })

      console.log(
        `[app-charts] country=${country} chart=${chart} genre=${genre} rows=${recorded.insertedRanks} baseline=${recorded.baseline} newApps=${recorded.newApps.length} newTerms=${recorded.newTerms.length}`
      )
      for (const term of recorded.newTerms) {
        console.log(`[app-chart-new-term] ${term.displayTerm} <- ${term.appName ?? term.firstAppId ?? "unknown"}`)
      }
    }
  } finally {
    await db.close()
  }
}

await run()
