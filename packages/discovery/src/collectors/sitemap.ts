import type { Collector, SitemapUrlEntry } from "@factory/shared"
import {
  configBoolean,
  configNumber,
  configString,
  configStringArray,
  makeSignal
} from "./base.js"
import { collectSitemapUrls } from "./sitemap-fetcher.js"
import { extractKeywordFromUrl } from "./sitemap-keywords.js"
export { parseSitemapDocument, parseTextSitemap, parseXmlSitemap } from "./sitemap-parser.js"
export { extractKeywordFromUrl } from "./sitemap-keywords.js"
export { decodeSitemapBytes } from "./sitemap-fetcher.js"

function matchesFilters(url: string, includes: string[], excludes: string[]): boolean {
  if (includes.length > 0 && !includes.some((value) => url.includes(value))) return false
  if (excludes.some((value) => url.includes(value))) return false
  return true
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
  fetchImpl: typeof fetch,
  userAgent: string,
  timeoutSeconds: number
): Promise<{ title?: string; h1?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": userAgent, Accept: "text/html,*/*;q=0.8" }
    })
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
  } finally {
    clearTimeout(timer)
  }
}

export const sitemapCollector: Collector = {
  type: "sitemap",
  async collect(target, cursor, context) {
    const roots = configStringArray(target.config, "sitemapUrls")
    const singleRoot = configString(target.config, "sitemapUrl")
    if (singleRoot && !roots.includes(singleRoot)) roots.unshift(singleRoot)
    if (roots.length === 0) throw new Error("Missing required config: sitemapUrl or sitemapUrls")

    const maxSitemaps = Math.min(200, Math.max(1, configNumber(target.config, "maxSitemaps", 30)))
    const maxUrls = Math.min(100_000, Math.max(100, configNumber(target.config, "maxUrls", 20_000)))
    const maxNewUrls = Math.min(2_000, Math.max(1, configNumber(target.config, "maxNewUrls", 100)))
    const timeoutSeconds = Math.min(120, Math.max(5, configNumber(target.config, "timeoutSeconds", 30)))
    const userAgent = configString(target.config, "userAgent", "auto-site-factory/0.1 sitemap-monitor")
    const includes = configStringArray(target.config, "urlIncludes")
    const excludes = configStringArray(target.config, "urlExcludes")
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)
    const fetchMetadata = configBoolean(target.config, "fetchPageMetadata", true)
    const curlFallback = configBoolean(target.config, "curlFallback", true)

    const discoveredUrls = await collectSitemapUrls(roots, context.fetch, {
      userAgent,
      timeoutSeconds,
      maxSitemaps,
      maxUrls,
      curlFallback
    })
    const urls = discoveredUrls.filter((url) => matchesFilters(url, includes, excludes))
    const entries: SitemapUrlEntry[] = urls.map((url) => ({
      url,
      keyword: extractKeywordFromUrl(url)
    }))

    let newUrls: string[]
    let pendingCount = 0
    let initialized = cursor?.initialized === true

    if (context.sitemapStore) {
      const reconciled = await context.sitemapStore.reconcile(
        target.id,
        entries,
        context.now,
        baselineOnFirstRun,
        maxNewUrls
      )
      initialized = reconciled.initialized
      newUrls = reconciled.pendingUrls
      pendingCount = reconciled.pendingCount
    } else {
      const previous = new Set(
        Array.isArray(cursor?.seenUrls)
          ? cursor.seenUrls.filter((url): url is string => typeof url === "string")
          : []
      )
      const allNew = !initialized && baselineOnFirstRun
        ? []
        : urls.filter((url) => !previous.has(url))
      newUrls = allNew.slice(0, maxNewUrls)
      pendingCount = Math.max(0, allNew.length - newUrls.length)
    }

    const signals = []
    for (const url of newUrls) {
      const pageMetadata = fetchMetadata
        ? await fetchPageMetadata(url, context.fetch, userAgent, timeoutSeconds)
        : {}
      const keyword = extractKeywordFromUrl(url)
      if (context.sitemapStore) {
        await context.sitemapStore.updateMetadata(target.id, url, pageMetadata)
      }
      const entityType = configString(target.config, "entityType", "OTHER")
      signals.push(makeSignal("sitemap", target, url, {
        title: pageMetadata.h1 ?? pageMetadata.title ?? keyword ?? url,
        url,
        discoveredAt: context.now,
        metadata: {
          sitemapUrls: roots,
          keyword,
          pageTitle: pageMetadata.title,
          h1: pageMetadata.h1,
          ...(keyword ? { directEntity: keyword, entityType } : {})
        }
      }))
    }

    const nextCursor = context.sitemapStore
      ? {
          initialized: true,
          snapshotAt: context.now.toISOString(),
          sitemapUrls: roots,
          urlCount: urls.length,
          pendingNewUrls: Math.max(0, pendingCount - newUrls.length)
        }
      : {
          initialized: true,
          seenUrls: !initialized && baselineOnFirstRun
            ? urls
            : [...new Set([
                ...(Array.isArray(cursor?.seenUrls) ? cursor.seenUrls.filter((url): url is string => typeof url === "string") : []),
                ...newUrls
              ])].slice(-maxUrls),
          snapshotAt: context.now.toISOString(),
          sitemapUrls: roots,
          pendingNewUrls: pendingCount
        }

    return {
      signals,
      nextCursor,
      afterPersist: context.sitemapStore && newUrls.length > 0
        ? () => context.sitemapStore!.markEmitted(target.id, newUrls, context.now)
        : undefined
    }
  }
}
