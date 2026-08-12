import type { Collector } from "@factory/shared"
import { configString, makeSignal, requireConfigString } from "./base.js"

export function parseSitemapUrls(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
    .map((match) => match[1].replace(/&amp;/g, "&").trim())
    .filter(Boolean)
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

async function fetchPageMetadata(url: string, fetchImpl: typeof fetch): Promise<{ title?: string; h1?: string }> {
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
    const response = await context.fetch(sitemapUrl)
    if (!response.ok) throw new Error(`Sitemap ${response.status}: ${sitemapUrl}`)
    const urls = parseSitemapUrls(await response.text())
    const previous = new Set(Array.isArray(cursor?.seenUrls) ? cursor.seenUrls.filter((url): url is string => typeof url === "string") : [])
    const initialized = cursor?.initialized === true
    const baselineOnFirstRun = target.config.baselineOnFirstRun !== false
    const newUrls = !initialized && baselineOnFirstRun ? [] : urls.filter((url) => !previous.has(url))
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

    return {
      signals,
      nextCursor: {
        initialized: true,
        seenUrls: urls,
        snapshotAt: context.now.toISOString(),
        sitemapUrl: configString(target.config, "sitemapUrl")
      }
    }
  }
}
