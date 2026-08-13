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
  firstSeenAt: string
  lastSeenAt: string
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
  { value: "igdb", label: "IGDB" },
  { value: "steam_store", label: "Steam Store" },
  { value: "wiki", label: "Wiki" },
  { value: "reddit", label: "Reddit" },
  { value: "youtube", label: "YouTube" },
  { value: "discord", label: "Discord" },
  { value: "x", label: "X" },
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
    return request<{ candidates: DiscoveryCandidate[]; enabledTargetCount: number }>(
      `/api/discovery/candidates?${params}`
    )
  },
  targets: () => request<{ targets: SitemapTarget[] }>("/api/sitemap/targets"),
  runs: () => request<{ runs: SitemapRun[] }>("/api/sitemap/runs"),
  anomalies: () => request<{ anomalies: SitemapAnomaly[] }>("/api/sitemap/anomalies"),
  run: () => request<{ status: string; workflow_run_id?: number; html_url?: string }>("/api/sitemap/run", { method: "POST" }),
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
