export type SitemapTarget = {
  id: string
  name: string
  scope: string
  enabled: boolean
  config: Record<string, unknown>
  totalUrlCount: number
  activeUrlCount: number
  lastSuccessAt?: string
  lastAttemptAt?: string
}

export type DiscoveryCandidate = {
  id: string
  entityId: string
  name: string
  entityType: string
  scope: string
  status: string
  mentionCount: number
  sourceCount: number
  sourceTypes: string[]
  platformCount: number
  platforms: string[]
  targetCount: number
  authorCount: number
  metricSampleCount: number
  scoreDelta24h: number
  commentDelta24h: number
  viewDelta24h: number
  shareDelta24h: number
  engagementDelta24h: number
  corroboration: "single_source" | "launch_only" | "organic"
  stage: "DISCOVERED" | "ACCELERATING" | "CROSS_PLATFORM" | "MEDIA_PICKUP" | "BREAKOUT"
  viralScore: number
  firstSeenAt: string
  lastSeenAt: string
}

export type KeywordCandidate = {
  id: string
  entityId: string
  keyword: string
  normalizedKeyword: string
  status: "pending_validation" | "low_searchability"
  searchabilityScore: number
  generationKind: "entity_name" | "scope_context"
  generationReasons: string[]
  firstSeenAt: string
  lastSeenAt: string
  entityName: string
  entityType: string
  scope: string
  sourceTypes: string[]
  mentionCount: number
}

export type SteamGame = {
  appid: number
  name: string
  firstObservedAt: string
  isBaseline: boolean
  steamLastModifiedAt?: string
  appListChangedAt?: string
  opportunityAt?: string
  opportunityReason?: "new_app" | "released" | "demo" | "playtest" | "ccu_spike" | "follower_spike"
  storeStatus: "unknown" | "coming_soon" | "released" | "unavailable"
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
  followersSource?: "store_dlc" | "community_xml"
  followers24hDelta?: number
  followers7dDelta?: number
  followers7dGrowthPct?: number
  followersTrend: Array<{ recordedAt: string; followers: number }>
  ccuSource?: "game" | "demo" | "playtest"
  ccuAppid?: number
  ccuCurrent?: number
  ccu24hPeak?: number
  ccu7dPeak?: number
  ccu24hGrowthPct?: number
  lastStoreCheckedAt?: string
  lastFollowerCheckedAt?: string
  lastCcuCheckedAt?: string
}

export type AppChartEntry = {
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

export type AppChartNewTerm = {
  term: string
  displayTerm: string
  firstSeenAt: string
  firstAppId?: string
  appName?: string
}

export type SitemapRun = {
  runId: string
  targetId: string
  targetName: string
  status: string
  signalCount: number
  error?: string
  startedAt: string
  finishedAt?: string
}

export type SitemapAnomaly = {
  severity: "info" | "warning" | "critical"
  code: string
  targetId: string
  message: string
  recordedAt?: string
}

export const SOURCE_TYPE_OPTIONS = [
  { value: "official_api", label: "Official API" },
  { value: "wiki", label: "Wiki" },
  { value: "reddit", label: "Reddit" },
  { value: "hn", label: "Hacker News" },
  { value: "rss", label: "RSS / Atom" },
  { value: "sitemap", label: "Sitemap" }
] as const

export const KEYWORD_SOURCE_TYPE_OPTIONS = [
  { value: "official_api", label: "Official API" },
  { value: "wiki", label: "Wiki" },
  { value: "sitemap", label: "Sitemap" }
] as const

const TOKEN_KEY = "auto-site-factory-dashboard-token"

export function getDashboardToken(): string {
  return window.sessionStorage.getItem(TOKEN_KEY)?.trim() || ""
}

export function setDashboardToken(token: string): void {
  const value = token.trim()
  if (value) window.sessionStorage.setItem(TOKEN_KEY, value)
  else window.sessionStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getDashboardToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || response.statusText)
  }
  return response.json() as Promise<T>
}

export const api = {
  candidates: (range: string, sourceType?: string) => {
    const params = new URLSearchParams({ range })
    if (sourceType) params.set("sourceType", sourceType)
    if (window.location.pathname === "/discovery/viral") params.set("scope", "viral")
    return request<{ candidates: DiscoveryCandidate[]; enabledTargetCount: number }>(
      `/api/discovery/candidates?${params}`
    )
  },
  keywords: (range: string, options: { sourceType?: string; status?: string } = {}) => {
    const params = new URLSearchParams({ range })
    if (options.sourceType) params.set("sourceType", options.sourceType)
    if (options.status) params.set("status", options.status)
    return request<{ keywords: KeywordCandidate[] }>(`/api/discovery/keywords?${params}`)
  },
  steamGames: (options: { range: string; status?: string; minCcu?: string; sort?: string; includeBaseline?: boolean }) => {
    const params = new URLSearchParams({ range: options.range })
    if (options.status) params.set("status", options.status)
    if (options.minCcu) params.set("minCcu", options.minCcu)
    if (options.sort) params.set("sort", options.sort)
    if (options.includeBaseline) params.set("includeBaseline", "true")
    return request<{ games: SteamGame[] }>(`/api/steam/games?${params}`)
  },
  appCharts: (options: {
    country?: string
    chart?: string
    genre?: string
    sort?: string
    range?: string
    newAppsOnly?: boolean
    newTermsOnly?: boolean
    limit?: number
  } = {}) => {
    const params = new URLSearchParams({
      country: options.country ?? "us",
      chart: options.chart ?? "top-free",
      genre: options.genre ?? "all",
      sort: options.sort ?? "rising",
      range: options.range ?? "7d",
      limit: String(options.limit ?? 100)
    })
    if (options.newAppsOnly) params.set("newAppsOnly", "true")
    if (options.newTermsOnly) params.set("newTermsOnly", "true")
    return request<{ entries: AppChartEntry[]; newTerms: AppChartNewTerm[] }>(`/api/app-charts?${params}`)
  },
  targets: () => request<{ targets: SitemapTarget[] }>("/api/sitemap/targets"),
  runs: () => request<{ runs: SitemapRun[] }>("/api/sitemap/runs"),
  anomalies: () => request<{ anomalies: SitemapAnomaly[] }>("/api/sitemap/anomalies"),
  run: () => {
    const endpoint = window.location.pathname === "/discovery/viral"
      ? "/api/discovery/viral/run"
      : "/api/sitemap/run"
    return request<{ status: string; workflow_run_id?: number; html_url?: string }>(endpoint, { method: "POST" })
  },
  updateTarget: (target: SitemapTarget) => request(`/api/sitemap/targets/${encodeURIComponent(target.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: target.name,
      scope: target.scope,
      enabled: target.enabled,
      config: target.config
    })
  }),
  createTarget: (target: { id: string; name: string; scope: string; enabled: boolean; config: Record<string, unknown> }) =>
    request("/api/sitemap/targets", { method: "POST", body: JSON.stringify(target) })
}
