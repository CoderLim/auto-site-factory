import { spawn } from "node:child_process"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { fileURLToPath } from "node:url"
import { AppChartRepository, Database, DiscoveryRepository, KeywordRepository, SitemapRepository, SteamRepository, type AppChartSort } from "@factory/database"
import type { SignalSourceType, SourceTarget } from "@factory/shared"

const port = Number(process.env.API_PORT ?? "8787")
const dashboardToken = process.env.DASHBOARD_TOKEN?.trim() || ""

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS"
  })
  response.end(JSON.stringify(body))
}

function authorized(request: IncomingMessage): boolean {
  if (!dashboardToken) return true
  return request.headers.authorization === `Bearer ${dashboardToken}`
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const text = Buffer.concat(chunks).toString("utf8").trim()
  return (text ? JSON.parse(text) : {}) as T
}

function sinceForRange(range: string | null): Date {
  const hours = range === "90d" ? 90 * 24 : range === "30d" ? 30 * 24 : range === "7d" ? 7 * 24 : 24
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function startSitemapWorker(): { pid?: number } {
  const workerPath = fileURLToPath(new URL("../../worker/dist/index.js", import.meta.url))
  const child = spawn(process.execPath, [workerPath, "--once", "--source=sitemap"], {
    detached: true,
    stdio: "ignore",
    env: process.env
  })
  child.unref()
  return { pid: child.pid }
}

const server = createServer(async (request, response) => {
  if (!request.url || !request.method) return sendJson(response, 400, { error: "invalid request" })
  if (request.method === "OPTIONS") return sendJson(response, 204, {})

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`)
  if (url.pathname === "/api/health") return sendJson(response, 200, { status: "ok", service: "auto-site-factory-api" })
  if (!authorized(request)) return sendJson(response, 401, { error: "unauthorized" })

  const db = new Database()
  const sitemap = new SitemapRepository(db)
  const discovery = new DiscoveryRepository(db)
  const keyword = new KeywordRepository(db)
  const steam = new SteamRepository(db)
  const appCharts = new AppChartRepository(db)

  try {
    if (request.method === "GET" && url.pathname === "/api/discovery/candidates") {
      const range = url.searchParams.get("range")
      const sourceType = (url.searchParams.get("sourceType") || undefined) as SignalSourceType | undefined
      const [candidates, enabledTargetCount] = await Promise.all([
        discovery.listCandidates(sinceForRange(range), { sourceType }),
        discovery.countEnabledTargets()
      ])
      return sendJson(response, 200, { candidates, enabledTargetCount })
    }

    if (request.method === "GET" && url.pathname === "/api/discovery/keywords") {
      const range = url.searchParams.get("range")
      const sourceType = (url.searchParams.get("sourceType") || undefined) as SignalSourceType | undefined
      const status = url.searchParams.get("status") || undefined
      return sendJson(response, 200, {
        keywords: await keyword.listKeywords(sinceForRange(range), { sourceType, status })
      })
    }

    if (request.method === "GET" && url.pathname === "/api/steam/games") {
      const range = url.searchParams.get("range")
      const status = url.searchParams.get("status") || undefined
      const minCcuRaw = url.searchParams.get("minCcu")
      const minCcu = minCcuRaw ? Number(minCcuRaw) : undefined
      const includeBaseline = url.searchParams.get("includeBaseline") === "true"
      const sortRaw = url.searchParams.get("sort")
      const sort = sortRaw === "ccu" || sortRaw === "growth" || sortRaw === "followers" || sortRaw === "follower_growth"
        ? sortRaw
        : "recent"
      return sendJson(response, 200, {
        games: await steam.listGames({
          since: sinceForRange(range),
          status,
          minCcu: Number.isFinite(minCcu) ? minCcu : undefined,
          includeBaseline,
          sort
        })
      })
    }

    if (request.method === "GET" && url.pathname === "/api/app-charts") {
      const country = (url.searchParams.get("country") || "us").toLowerCase()
      const chart = url.searchParams.get("chart") || "top-free"
      const genre = url.searchParams.get("genre") || "all"
      const sortRaw = url.searchParams.get("sort")
      const sort: AppChartSort = sortRaw === "rank" || sortRaw === "new" ? sortRaw : "rising"
      const newAppsOnly = url.searchParams.get("newAppsOnly") === "true"
      const newTermsOnly = url.searchParams.get("newTermsOnly") === "true"
      const limitRaw = Number(url.searchParams.get("limit") || "100")
      const limit = Number.isFinite(limitRaw) ? limitRaw : 100
      const range = url.searchParams.get("range") || "7d"
      const [entries, newTerms] = await Promise.all([
        appCharts.listChart({ country, chart, genre, sort, newAppsOnly, newTermsOnly, limit }),
        appCharts.listNewTerms({ since: sinceForRange(range), limit: 100 })
      ])
      return sendJson(response, 200, { entries, newTerms })
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/targets") {
      return sendJson(response, 200, { targets: await sitemap.listTargets() })
    }

    if (request.method === "POST" && url.pathname === "/api/sitemap/targets") {
      const body = await readJson<Partial<SourceTarget>>(request)
      if (!body.id || !body.name || !body.scope) return sendJson(response, 400, { error: "id, name and scope are required" })
      const target: SourceTarget = {
        id: body.id,
        sourceType: "sitemap",
        name: body.name,
        scope: body.scope,
        enabled: body.enabled !== false,
        config: body.config ?? {}
      }
      await sitemap.saveTarget(target)
      return sendJson(response, 201, { target })
    }

    const targetMatch = url.pathname.match(/^\/api\/sitemap\/targets\/([^/]+)$/)
    if (request.method === "PUT" && targetMatch) {
      const targetId = decodeURIComponent(targetMatch[1] ?? "")
      const existing = await sitemap.getTarget(targetId)
      if (!existing) return sendJson(response, 404, { error: "target not found" })
      const body = await readJson<Partial<SourceTarget>>(request)
      const target: SourceTarget = {
        ...existing,
        name: body.name ?? existing.name,
        scope: body.scope ?? existing.scope,
        enabled: body.enabled ?? existing.enabled,
        config: body.config ?? existing.config
      }
      await sitemap.saveTarget(target)
      return sendJson(response, 200, { target })
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/signals") {
      const range = url.searchParams.get("range")
      const targetId = url.searchParams.get("targetId") || undefined
      return sendJson(response, 200, {
        signals: await sitemap.listSignals(sinceForRange(range), targetId)
      })
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/runs") {
      return sendJson(response, 200, { runs: await sitemap.listRuns(100) })
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/anomalies") {
      return sendJson(response, 200, { anomalies: await sitemap.listAnomalies() })
    }

    if (request.method === "POST" && url.pathname === "/api/sitemap/run") {
      return sendJson(response, 202, { status: "queued", ...startSitemapWorker() })
    }

    return sendJson(response, 404, { error: "not found" })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[api] request failed", error)
    return sendJson(response, 500, { error: message })
  } finally {
    await db.close()
  }
})

server.listen(port, () => {
  console.log(`[api] listening on http://127.0.0.1:${port}`)
})
