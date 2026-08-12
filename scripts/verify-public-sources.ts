import assert from "node:assert/strict"
import type { SourceTarget } from "@factory/shared"
import { officialApiCollector } from "../packages/discovery/src/collectors/official-api.js"
import { sitemapCollector } from "../packages/discovery/src/collectors/sitemap.js"
import { wikiCollector } from "../packages/discovery/src/collectors/wiki.js"

const now = new Date()

async function verifyFandom() {
  const target: SourceTarget = {
    id: "fandom-blox-fruits-smoke",
    sourceType: "wiki",
    name: "Blox Fruits Fandom",
    scope: "blox-fruits",
    enabled: true,
    config: {
      apiUrl: "https://blox-fruits.fandom.com/api.php",
      namespace: 0,
      limit: 20
    }
  }

  const cursor = { timestamp: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString() }
  const result = await wikiCollector.collect(target, cursor, { now, fetch })
  assert.ok(result.signals.length > 0, "Fandom returned no recent-change signals in the last 30 days")
  assert.ok(result.signals.every((signal) => signal.title && signal.publishedAt), "Fandom signals are missing title/timestamp")

  return {
    source: "fandom",
    endpoint: target.config.apiUrl,
    count: result.signals.length,
    samples: result.signals.slice(0, 5).map((signal) => ({
      title: signal.title,
      publishedAt: signal.publishedAt?.toISOString(),
      changeType: signal.metadata.changeType
    }))
  }
}

async function verifyHuggingFace() {
  const target: SourceTarget = {
    id: "huggingface-models-smoke",
    sourceType: "official_api",
    name: "Hugging Face newest models",
    scope: "ai",
    enabled: true,
    config: {
      url: "https://huggingface.co/api/models?sort=createdAt&direction=-1&limit=20",
      idField: "id",
      nameField: "id",
      nameTransform: "basename",
      publishedAtField: "createdAt",
      entityType: "AI_MODEL",
      baselineOnFirstRun: false
    }
  }

  const result = await officialApiCollector.collect(target, undefined, { now, fetch })
  assert.ok(result.signals.length > 0, "Hugging Face returned no model signals")
  assert.ok(result.signals.every((signal) => signal.title && signal.publishedAt), "Hugging Face signals are missing model name/createdAt")

  const newest = [...result.signals]
    .filter((signal) => signal.publishedAt)
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))

  assert.equal(result.signals[0]?.publishedAt?.getTime(), newest[0]?.publishedAt?.getTime(), "Hugging Face response is not sorted newest-first")

  return {
    source: "huggingface",
    endpoint: target.config.url,
    count: result.signals.length,
    samples: result.signals.slice(0, 5).map((signal) => ({
      name: signal.title,
      createdAt: signal.publishedAt?.toISOString(),
      externalId: signal.externalId
    }))
  }
}

async function verifySitemap() {
  const target: SourceTarget = {
    id: "sitemap-lagged-smoke",
    sourceType: "sitemap",
    name: "Lagged text sitemap",
    scope: "web-games",
    enabled: true,
    config: {
      sitemapUrl: "https://lagged.com/sitemap.txt",
      entityType: "GAME",
      baselineOnFirstRun: false,
      fetchPageMetadata: false,
      curlFallback: true,
      maxUrls: 100,
      maxNewUrls: 20
    }
  }

  const result = await sitemapCollector.collect(target, undefined, { now, fetch })
  assert.ok(result.signals.length > 0, "Migrated sitemap collector returned no Lagged signals")
  const signalsWithKeyword = result.signals.filter(
    (signal) => typeof signal.metadata.keyword === "string" && signal.metadata.keyword.trim().length > 1
  )
  assert.ok(
    signalsWithKeyword.length > 0,
    "Migrated sitemap collector did not extract any valid URL keywords"
  )

  return {
    source: "sitemap",
    endpoint: target.config.sitemapUrl,
    transport: "legacy sitemap-monitor target through Factory sitemapCollector",
    count: result.signals.length,
    keywordCount: signalsWithKeyword.length,
    samples: signalsWithKeyword.slice(0, 5).map((signal) => ({
      title: signal.title,
      keyword: signal.metadata.keyword,
      url: signal.url
    }))
  }
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

async function verifySteam() {
  const endpoint = "https://store.steampowered.com/search/?sort_by=Released_DESC&category1=998&ndl=1"
  const response = await fetch(endpoint, {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; AutoSiteFactory/0.1; +https://github.com/CoderLim/auto-site-factory)"
    }
  })
  assert.ok(response.ok, `Steam Store returned HTTP ${response.status}`)
  const html = await response.text()

  const titles = [...html.matchAll(/<span class="title">([^<]+)<\/span>/g)]
    .map((match) => decodeHtml(match[1]?.trim() ?? ""))
    .filter(Boolean)
  const appIds = [...html.matchAll(/data-ds-appid="(\d+)"/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value))
  const releaseDates = [...html.matchAll(/<div[^>]*class="[^"]*search_released[^"]*"[^>]*>\s*([^<]*?)\s*<\/div>/g)]
    .map((match) => decodeHtml(match[1]?.trim() ?? ""))
    .filter(Boolean)

  assert.ok(titles.length >= 5, "Steam Store release-date search returned fewer than five titles")
  assert.ok(appIds.length >= 5, "Steam Store search did not expose app IDs")
  assert.ok(releaseDates.length >= 5, `Steam Store search did not expose release dates (titles=${titles.length}, appIds=${appIds.length})`)

  return {
    source: "steam",
    endpoint,
    transport: "official Steam Store HTML (not Steam Web API)",
    count: titles.length,
    samples: titles.slice(0, 5).map((title, index) => ({
      title,
      appId: appIds[index],
      releaseDate: releaseDates[index]
    }))
  }
}

async function main() {
  const results: unknown[] = []
  for (const verify of [verifySteam, verifyFandom, verifyHuggingFace, verifySitemap]) {
    const startedAt = Date.now()
    try {
      const result = await verify()
      results.push({ ...result, ok: true, durationMs: Date.now() - startedAt })
    } catch (error) {
      results.push({
        source: verify.name.replace(/^verify/, "").toLowerCase(),
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2))
  const failures = results.filter((result) => !(result as { ok?: boolean }).ok)
  if (failures.length > 0) process.exitCode = 1
}

await main()
