import type { Collector } from "@factory/shared"
import {
  configNumber,
  configString,
  configStringArray,
  makeSignal,
  requireConfigString
} from "./base.js"

export function parseSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean)
}

export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml)
}

function matchesFilters(url: string, includes: string[], excludes: string[]): boolean {
  if (includes.length > 0 && !includes.some((value) => url.includes(value))) return false
  if (excludes.some((value) => url.includes(value))) return false
  return true
}

async function collectSitemapUrls(
  sitemapUrl: string,
  fetchImpl: typeof fetch,
  maxSitemaps: number,
  maxUrls: number
): Promise<string[]> {
  const queue = [sitemapUrl]
  const visited = new Set<string>()
  const urls: string[] = []

  while (queue.length > 0 && visited.size < maxSitemaps && urls.length < maxUrls) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    const response = await fetchImpl(current, { redirect: "follow" })
    if (!response.ok) throw new Error(`Sitemap ${response.status}: ${current}`)
    const xml = await response.text()
    const locations = parseSitemapUrls(xml)

    if (isSitemapIndex(xml)) {
      for (const child of locations) {
        if (!visited.has(child) && queue.length + visited.size < maxSitemaps) queue.push(child)
      }
      continue
    }

    for (const url of locations) {
      urls.push(url)
      if (urls.length >= maxUrls) break
    }
  }

  return [...new Set(urls)]
}

function htmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchPageMetadata(
  url: string,
  fetchImpl: typeof fetch
): Promise<{ title?: string; h1?: string }> {
  try {
    const response = await fetchImpl(url, { redirect: "follow" })
    if (!response.ok) return {}
    const html = await response.text()
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    return {
      title: title ? htmlText(title) : undefined,
      h1: h1 ? htmlText(h1) : undefined
    }
  } catch {
    return {}
  }
}

export const sitemapCollector: Collector = {
  type: "sitemap",
  async collect(target, cursor, context) {
    const sitemapUrl = requireConfigString(target.config, "sitemapUrl")
    const maxSitemaps = Math.min(100, Math.max(1, configNumber(target.config, "maxSitemaps", 20)))
    const maxUrls = Math.min(50_000, Math.max(100, configNumber(target.config, "maxUrls", 10_000)))
    const maxNewUrls = Math.min(500, Math.max(1, configNumber(target.config, "maxNewUrls", 50)))
    const includes = configStringArray(target.config, "urlIncludes")
    const excludes = configStringArray(target.config, "urlExcludes")

    const discoveredUrls = await collectSitemapUrls(
      sitemapUrl,
      context.fetch,
      maxSitemaps,
      maxUrls
    )
    const urls = discoveredUrls.filter((url) => matchesFilters(url, includes, excludes))

    const previous = new Set(
      Array.isArray(cursor?.seenUrls)
        ? cursor.seenUrls.filter((url): url is string => typeof url === "string")
        : []
    )
    const initialized = cursor?.initialized === true
    const baselineOnFirstRun = target.config.baselineOnFirstRun !== false
    const allNewUrls = !initialized && baselineOnFirstRun
      ? []
      : urls.filter((url) => !previous.has(url))
    const newUrls = allNewUrls.slice(0, maxNewUrls)
    const shouldFetchMetadata = target.config.fetchPageMetadata !== false

    const signals = []
    for (const url of newUrls) {
      const metadata = shouldFetchMetadata ? await fetchPageMetadata(url, context.fetch) : {}
      const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? ""
      signals.push(makeSignal("sitemap", target, url, {
        title: metadata.h1 ?? metadata.title ?? slug.replace(/[-_]+/g, " "),
        url,
        discoveredAt: context.now,
        metadata: { sitemapUrl, slug, pageTitle: metadata.title, h1: metadata.h1 }
      }))
    }

    const nextSeenUrls = !initialized && baselineOnFirstRun
      ? urls
      : [...new Set([...previous, ...newUrls])].slice(-maxUrls)

    return {
      signals,
      nextCursor: {
        initialized: true,
        seenUrls: nextSeenUrls,
        snapshotAt: context.now.toISOString(),
        sitemapUrl: configString(target.config, "sitemapUrl"),
        pendingNewUrls: Math.max(0, allNewUrls.length - newUrls.length)
      }
    }
  }
}
