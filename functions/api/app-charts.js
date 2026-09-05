import { Client } from "pg"
import { AppChartRepository } from "@factory/database"

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

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === "OPTIONS") return new Response(null, { status: 204 })
  if (request.method !== "GET") return json({ error: "method not allowed" }, 405)
  if (!authorized(request, env)) return json({ error: "unauthorized" }, 401)
  if (!env.HYPERDRIVE?.connectionString) return json({ error: "Missing Cloudflare Hyperdrive binding: HYPERDRIVE" }, 500)

  const url = new URL(request.url)
  const country = (url.searchParams.get("country") || "us").toLowerCase()
  const chart = url.searchParams.get("chart") || "top-free"
  const genre = url.searchParams.get("genre") || "all"
  const sortRaw = url.searchParams.get("sort")
  const sort = sortRaw === "rank" || sortRaw === "new" ? sortRaw : "rising"
  const newAppsOnly = url.searchParams.get("newAppsOnly") === "true"
  const newTermsOnly = url.searchParams.get("newTermsOnly") === "true"
  const limitRaw = Number(url.searchParams.get("limit") || "100")
  const limit = Number.isFinite(limitRaw) ? limitRaw : 100
  const range = url.searchParams.get("range") || "7d"

  const client = new Client({ connectionString: env.HYPERDRIVE.connectionString })
  await client.connect()
  const database = {
    query(text, params = []) {
      return client.query(text, params)
    }
  }

  try {
    const appCharts = new AppChartRepository(database)
    const [entries, newTerms] = await Promise.all([
      appCharts.listChart({ country, chart, genre, sort, newAppsOnly, newTermsOnly, limit }),
      appCharts.listNewTerms({ since: sinceForRange(range), limit: 100 })
    ])
    return json({ entries, newTerms })
  } catch (error) {
    console.error("[pages-api] app charts request failed", error)
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  } finally {
    await client.end()
  }
}
