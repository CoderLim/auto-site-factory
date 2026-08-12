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

export type SitemapSignal = {
  id: string
  targetId: string
  targetName: string
  url?: string
  title?: string
  keyword?: string
  pageTitle?: string
  h1?: string
  discoveredAt: string
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

const token = (import.meta.env.VITE_DASHBOARD_TOKEN as string | undefined)?.trim() || ""

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  targets: () => request<{ targets: SitemapTarget[] }>("/api/sitemap/targets"),
  signals: (range: string, targetId?: string) => {
    const params = new URLSearchParams({ range })
    if (targetId) params.set("targetId", targetId)
    return request<{ signals: SitemapSignal[] }>(`/api/sitemap/signals?${params}`)
  },
  runs: () => request<{ runs: SitemapRun[] }>("/api/sitemap/runs"),
  anomalies: () => request<{ anomalies: SitemapAnomaly[] }>("/api/sitemap/anomalies"),
  run: () => request<{ status: string; pid?: number }>("/api/sitemap/run", { method: "POST" }),
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
