import { Client } from "pg"
import { DiscoveryRepository, KeywordRepository, SitemapRepository, SteamRepository } from "@factory/database"

const DEFAULT_REPOSITORY = "CoderLim/auto-site-factory"
const DEFAULT_WORKFLOW = "discovery-cron.yml"
const DEFAULT_REF = "main"

function json(body, status = 200) {
  return Response.json(body, { status })
}

function authorized(request, env) {
  const token = String(env.DASHBOARD_TOKEN ?? "").trim()
  if (!token) return true
  return request.headers.get("authorization") === `Bearer ${token}`
}

function sinceForRange(range) {
  const hours = range === "90d" ? 90 * 24 : range === "30d" ? 30 * 24 : range === "7d" ? 7 * 24 : 24
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

async function withRepos(env, callback) {
  if (!env.HYPERDRIVE?.connectionString) {
    throw new Error("Missing Cloudflare Hyperdrive binding: HYPERDRIVE")
  }

  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
  await client.connect()
  const database = {
    query(text, params = []) {
      return client.query(text, params)
    }
  }

  try {
    return await callback({
      sitemap: new SitemapRepository(database),
      discovery: new DiscoveryRepository(database),
      keyword: new KeywordRepository(database),
      steam: new SteamRepository(database)
    })
  } finally {
    await client.end()
  }
}

async function dispatchDiscovery(env) {
  const token = String(env.GITHUB_DISPATCH_TOKEN ?? "").trim()
  if (!token) {
    throw new Error("Missing Cloudflare secret: GITHUB_DISPATCH_TOKEN")
  }

  const repository = String(env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY).trim()
  const workflow = String(env.GITHUB_WORKFLOW_FILE ?? DEFAULT_WORKFLOW).trim()
  const ref = String(env.GITHUB_REF ?? DEFAULT_REF).trim()
  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "auto-site-factory-dashboard",
      "X-GitHub-Api-Version": "2026-03-10"
    },
    body: JSON.stringify({ ref })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`GitHub workflow dispatch failed (${response.status}): ${detail}`)
  }

  const text = await response.text()
  return text ? JSON.parse(text) : { status: "queued" }
}

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)

  if (request.method === "OPTIONS") return new Response(null, { status: 204 })
  if (url.pathname === "/api/health") return json({ status: "ok", service: "auto-site-factory-pages-api" })
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401)

  try {
    if (request.method === "GET" && url.pathname === "/api/discovery/candidates") {
      const range = url.searchParams.get("range")
      const sourceType = url.searchParams.get("sourceType") || undefined
      return await withRepos(env, async ({ discovery }) => {
        const [candidates, enabledTargetCount] = await Promise.all([
          discovery.listCandidates(sinceForRange(range), { sourceType }),
          discovery.countEnabledTargets()
        ])
        return json({ candidates, enabledTargetCount })
      })
    }

    if (request.method === "GET" && url.pathname === "/api/discovery/keywords") {
      const range = url.searchParams.get("range")
      const sourceType = url.searchParams.get("sourceType") || undefined
      const status = url.searchParams.get("status") || undefined
      return await withRepos(env, async ({ keyword }) => json({
        keywords: await keyword.listKeywords(sinceForRange(range), { sourceType, status })
      }))
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
      return await withRepos(env, async ({ steam }) => json({
        games: await steam.listGames({
          since: sinceForRange(range),
          status,
          minCcu: Number.isFinite(minCcu) ? minCcu : undefined,
          includeBaseline,
          sort
        })
      }))
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/targets") {
      return await withRepos(env, async ({ sitemap }) => json({ targets: await sitemap.listTargets() }))
    }

    if (request.method === "POST" && url.pathname === "/api/sitemap/targets") {
      const body = await request.json()
      if (!body.id || !body.name || !body.scope) return json({ error: "id, name and scope are required" }, 400)
      const target = {
        id: body.id,
        sourceType: "sitemap",
        name: body.name,
        scope: body.scope,
        enabled: body.enabled !== false,
        config: body.config ?? {}
      }
      return await withRepos(env, async ({ sitemap }) => {
        await sitemap.saveTarget(target)
        return json({ target }, 201)
      })
    }

    const targetMatch = url.pathname.match(/^\/api\/sitemap\/targets\/([^/]+)$/)
    if (request.method === "PUT" && targetMatch) {
      const targetId = decodeURIComponent(targetMatch[1] ?? "")
      const body = await request.json()
      return await withRepos(env, async ({ sitemap }) => {
        const existing = await sitemap.getTarget(targetId)
        if (!existing) return json({ error: "target not found" }, 404)
        const target = {
          ...existing,
          name: body.name ?? existing.name,
          scope: body.scope ?? existing.scope,
          enabled: body.enabled ?? existing.enabled,
          config: body.config ?? existing.config
        }
        await sitemap.saveTarget(target)
        return json({ target })
      })
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/signals") {
      const range = url.searchParams.get("range")
      const targetId = url.searchParams.get("targetId") || undefined
      return await withRepos(env, async ({ sitemap }) =>
        json({ signals: await sitemap.listSignals(sinceForRange(range), targetId) })
      )
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/runs") {
      return await withRepos(env, async ({ sitemap }) => json({ runs: await sitemap.listRuns(100) }))
    }

    if (request.method === "GET" && url.pathname === "/api/sitemap/anomalies") {
      return await withRepos(env, async ({ sitemap }) => json({ anomalies: await sitemap.listAnomalies() }))
    }

    if (request.method === "POST" && url.pathname === "/api/sitemap/run") {
      const result = await dispatchDiscovery(env)
      return json({ status: "queued", ...result }, 202)
    }

    return json({ error: "not found" }, 404)
  } catch (error) {
    console.error("[pages-api] request failed", error)
    const message = error instanceof Error ? error.message : String(error)
    return json({ error: message }, 500)
  }
}
