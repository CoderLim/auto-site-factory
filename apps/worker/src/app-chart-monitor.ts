import { AppChartRepository, Database, type AppChartEntryInput, type AppChartTermInput } from "@factory/database"

const DEFAULT_GENRES = ["all", "6007", "6002", "6008", "6027", "6017", "6012", "6014"]
const APPLE_RSS_BASE_URL = process.env.APP_CHART_RSS_BASE_URL?.trim() || "https://itunes.apple.com"
const ITUNES_LOOKUP_BASE_URL = process.env.APP_CHART_LOOKUP_BASE_URL?.trim() || "https://itunes.apple.com/lookup"

// Precision matters more than recall here. App Charts is a demand-discovery signal, so ordinary
// dictionary/product words should not become "new term" alerts merely because they first appeared
// in our own history. We only inspect the leading brand-like part of an App Store title and suppress
// common English words and generic app vocabulary.
const COMMON_TITLE_WORDS = new Set([
  "about", "access", "account", "action", "activity", "adventure", "after", "again", "album", "alerts",
  "all", "also", "amazing", "android", "anniversary", "answer", "answers", "apple", "apps", "assistant",
  "audio", "auto", "baby", "background", "bank", "battle", "beauty", "best", "better", "bible", "bike",
  "bill", "bills", "book", "books", "brain", "browser", "budget", "build", "business", "calendar",
  "camera", "card", "cards", "care", "cash", "center", "change", "chat", "check", "children", "church",
  "city", "clean", "cleaner", "clock", "cloud", "coach", "code", "color", "community", "companion",
  "contact", "contacts", "content", "control", "converter", "cook", "daily", "dance", "dating", "design",
  "designer", "diary", "dictionary", "digital", "document", "documents", "download", "drama", "dramas",
  "draw", "drawing", "drive", "easy", "edit", "editor", "education", "email", "english", "events", "family",
  "fast", "fetch", "file", "files", "finance", "find", "finder", "fish", "fitness", "food", "football",
  "free", "friend", "friends", "fun", "game", "games", "gift", "gifts", "gist", "guide", "habit", "health",
  "help", "home", "image", "images", "insect", "iphone", "ios", "journal", "kids", "language", "launch",
  "launcher", "learn", "learning", "life", "live", "lived", "location", "lock", "mail", "manager", "map",
  "maps", "master", "masters", "math", "meet", "meeting", "messages", "mobile", "money", "music", "news",
  "notes", "official", "online", "organizer", "party", "password", "photo", "photos", "picture", "planner",
  "play", "player", "plus", "premium", "productivity", "puzzle", "radio", "reader", "receipts", "record",
  "recorder", "remote", "scanner", "school", "search", "share", "shopping", "short", "sleep", "smart", "social",
  "sort", "sport", "sports", "store", "stories", "study", "supermarket", "task", "tasks", "test", "tests",
  "text", "timer", "tools", "tracker", "train", "training", "transfer", "translate", "translator", "travel",
  "tutor", "utility", "video", "videos", "voice", "vpn", "wallet", "watch", "weather", "well", "work", "workout",
  "world", "your", "from", "this", "that", "have", "more", "make", "with", "pro", "bubble", "jam", "headbands",
  "charades", "identifier", "digital", "camera", "share", "meet", "new"
])

interface ChartEntry {
  id: string
  rank: number
  name: string
  artist?: string
  icon?: string
  storeUrl?: string
  primaryGenreName?: string
  releaseDate?: string
}

interface ChartResponse {
  updatedAt?: string
  entries: ChartEntry[]
}

interface AppleRssEntry {
  "im:name"?: { label?: string }
  "im:artist"?: { label?: string }
  "im:image"?: Array<{ label?: string }>
  "im:releaseDate"?: { label?: string }
  id?: { label?: string; attributes?: { "im:id"?: string } }
  link?: { attributes?: { href?: string } } | Array<{ attributes?: { href?: string } }>
  category?: { attributes?: { label?: string; "im:id"?: string } }
}

interface AppleRssResponse {
  feed?: {
    updated?: { label?: string }
    entry?: AppleRssEntry[]
  }
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
        await sleep(retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : attempt * 2_000)
        continue
      }
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`)
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(attempt * 1_000)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

function normalizeTerm(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US")
}

function brandSegment(name: string): string {
  // App Store titles often use `Brand: description` or `Brand - description`. Only the leading
  // segment is useful for new-brand/new-concept discovery; description words create heavy noise.
  return name.normalize("NFKC").split(/\s*(?::|\||—|–|•|·|\s-\s)\s*/u, 1)[0]?.trim() ?? ""
}

function extractTerms(name: string): AppChartTermInput[] {
  const segment = brandSegment(name)
  const tokens = segment.match(/[A-Za-z][A-Za-z0-9]*/g)?.slice(0, 3) ?? []
  const seen = new Set<string>()
  const terms: AppChartTermInput[] = []

  for (const displayTerm of tokens) {
    const term = normalizeTerm(displayTerm)
    if (seen.has(term)) continue
    if (term.length < 4 || term.length > 28) continue
    if (/^\d+$/.test(term)) continue
    if (COMMON_TITLE_WORDS.has(term)) continue

    // Avoid version-like or mostly-numeric tokens while preserving coined brands such as ChatGPT,
    // VibeShort, Airlearn, Chillio, Praktika, etc.
    const letterCount = (displayTerm.match(/[A-Za-z]/g) ?? []).length
    if (letterCount < Math.ceil(displayTerm.length * 0.6)) continue

    seen.add(term)
    terms.push({ term, displayTerm })
  }

  return terms
}

function chartSlug(chart: string): string {
  if (chart === "top-paid") return "toppaidapplications"
  if (chart === "top-grossing") return "topgrossingapplications"
  return "topfreeapplications"
}

function appIdFromEntry(entry: AppleRssEntry): string | undefined {
  const direct = entry.id?.attributes?.["im:id"]?.trim()
  if (direct) return direct
  const match = entry.id?.label?.match(/\/id(\d+)/)
  return match?.[1]
}

function linkFromEntry(entry: AppleRssEntry): string | undefined {
  const link = entry.link
  if (Array.isArray(link)) {
    return link.find((item) => item.attributes?.href)?.attributes?.href
  }
  return link?.attributes?.href
}

function normalizeFeedDate(value?: string): string | undefined {
  if (!value) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined
}

async function fetchChart(country: string, chart: string, genre: string): Promise<ChartResponse> {
  const slug = chartSlug(chart)
  const genrePath = genre === "all" ? "" : `/genre=${encodeURIComponent(genre)}`
  const url = `${APPLE_RSS_BASE_URL}/${encodeURIComponent(country)}/rss/${slug}/limit=100${genrePath}/json`
  const response = await fetchJson<AppleRssResponse>(url)
  const feedEntries = Array.isArray(response.feed?.entry) ? response.feed.entry : []

  const entries = feedEntries.flatMap((entry, index) => {
    const id = appIdFromEntry(entry)
    const name = entry["im:name"]?.label?.trim()
    if (!id || !name) return []
    const images = Array.isArray(entry["im:image"]) ? entry["im:image"] : []
    return [{
      id,
      rank: index + 1,
      name,
      artist: entry["im:artist"]?.label?.trim() || undefined,
      icon: images.at(-1)?.label,
      storeUrl: linkFromEntry(entry),
      primaryGenreName: entry.category?.attributes?.label,
      releaseDate: normalizeFeedDate(entry["im:releaseDate"]?.label)
    }]
  })

  return {
    updatedAt: normalizeFeedDate(response.feed?.updated?.label),
    entries
  }
}

async function fetchMetadata(country: string, appIds: string[]): Promise<Map<string, LookupApp>> {
  const result = new Map<string, LookupApp>()
  const chunkSize = 50
  for (let index = 0; index < appIds.length; index += chunkSize) {
    const chunk = appIds.slice(index, index + chunkSize)
    const params = new URLSearchParams({ country: country.toLowerCase(), entity: "software", id: chunk.join(",") })
    try {
      const response = await fetchJson<LookupResponse>(`${ITUNES_LOOKUP_BASE_URL}?${params}`, 2)
      for (const app of response.results ?? []) {
        if (app.trackId == null) continue
        result.set(String(app.trackId), app)
      }
    } catch (error) {
      console.warn(`[app-charts] metadata lookup failed for ${chunk.length} apps; continuing with RSS metadata`, error)
    }
    if (index + chunkSize < appIds.length) await sleep(350)
  }
  return result
}

function toEntry(entry: ChartEntry, metadata: LookupApp | undefined, country: string): AppChartEntryInput | undefined {
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
    storeUrl: entry.storeUrl ?? metadata?.trackViewUrl ?? `https://apps.apple.com/${country}/app/id${encodeURIComponent(appId)}`,
    primaryGenreName: entry.primaryGenreName ?? metadata?.primaryGenreName,
    releaseDate: entry.releaseDate ?? metadata?.releaseDate,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : undefined,
    averageRating: Number.isFinite(metadata?.averageUserRating) ? metadata?.averageUserRating : undefined,
    terms: extractTerms(name)
  }
}

async function run(): Promise<void> {
  const country = (process.env.APP_CHART_COUNTRY?.trim() || "us").toLowerCase()
  const chart = process.env.APP_CHART_CHART?.trim() || "top-free"
  const genres = process.env.APP_CHART_GENRES?.split(",").map((item) => item.trim()).filter(Boolean) ?? DEFAULT_GENRES
  const db = new Database()
  const repository = new AppChartRepository(db)

  try {
    const charts = new Map<string, ChartResponse>()
    for (const genre of genres) {
      const response = await fetchChart(country, chart, genre)
      if (response.entries.length === 0) {
        console.warn(`[app-charts] empty Apple RSS chart country=${country} chart=${chart} genre=${genre}`)
        continue
      }
      charts.set(genre, response)
      if (genre !== genres.at(-1)) await sleep(300)
    }

    const uniqueAppIds = Array.from(new Set(Array.from(charts.values()).flatMap((item) => item.entries.map((entry) => entry.id))))
    const metadata = await fetchMetadata(country, uniqueAppIds)
    const runCapturedAt = new Date().toISOString()

    for (const [genre, chartResponse] of charts) {
      const entries = chartResponse.entries.flatMap((entry) => {
        const normalized = toEntry(entry, metadata.get(entry.id), country)
        return normalized ? [normalized] : []
      })
      const capturedAt = chartResponse.updatedAt ?? runCapturedAt

      const recorded = await repository.recordSnapshot({
        country,
        chart,
        genre,
        capturedAt,
        sourceUpdatedAt: chartResponse.updatedAt,
        entries
      })

      console.log(
        `[app-charts] source=apple-rss country=${country} chart=${chart} genre=${genre} rows=${recorded.insertedRanks} baseline=${recorded.baseline} newApps=${recorded.newApps.length} newTerms=${recorded.newTerms.length}`
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
