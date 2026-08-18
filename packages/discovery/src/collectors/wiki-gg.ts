import type { Collector } from "@factory/shared"
import { configBoolean, configNumber, configStringArray, makeSignal } from "./base.js"

interface WikiEntry {
  slug: string
  name: string
}

const DEFAULT_URLS = [
  "https://www.wiki.gg/wikis",
  "https://support.wiki.gg/index.php?title=Module%3AWikis%2Flist.json&action=raw&ctype=application%2Fjson",
  "https://support.wiki.gg/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&titles=Module%3AWikis%2Flist.json&format=json&formatversion=2"
]

const DEFAULT_IGNORED_SLUGS = new Set([
  "www",
  "support",
  "commons",
  "test",
  "defaultloadout"
])

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeSlug(value: string): string | undefined {
  const slug = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\.wiki\.gg.*$/, "")
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? slug : undefined
}

function nameFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function cleanWikiName(value: string, slug: string): string {
  const cleaned = decodeHtml(value)
    .replace(/\s+wiki(?:\.gg)?$/i, "")
    .trim()
  return cleaned || nameFromSlug(slug)
}

function addEntry(map: Map<string, WikiEntry>, slugValue: string, nameValue?: string): void {
  const slug = normalizeSlug(slugValue)
  if (!slug) return
  const name = cleanWikiName(nameValue ?? "", slug)
  const existing = map.get(slug)
  if (!existing || existing.name === nameFromSlug(slug)) {
    map.set(slug, { slug, name })
  }
}

function parseHtmlCatalog(text: string): WikiEntry[] {
  const entries = new Map<string, WikiEntry>()
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of text.matchAll(anchorPattern)) {
    const href = match[1] ?? ""
    const label = match[2] ?? ""
    const domainMatch = href.match(/(?:https?:)?\/\/([a-z0-9-]+)\.wiki\.gg(?:\/|$)/i)
    if (domainMatch?.[1]) {
      addEntry(entries, domainMatch[1], label)
      continue
    }
    const routeMatch = href.match(/^\/wikis\/([a-z0-9-]+)(?:[/?#]|$)/i)
    if (routeMatch?.[1]) addEntry(entries, routeMatch[1], label)
  }

  const domainPattern = /(?:https?:)?\/\/([a-z0-9-]+)\.wiki\.gg(?:\/|["'\s<])/gi
  for (const match of text.matchAll(domainPattern)) {
    if (match[1]) addEntry(entries, match[1])
  }
  return [...entries.values()]
}

function parseJsonCatalog(value: unknown): WikiEntry[] {
  const entries = new Map<string, WikiEntry>()

  function visit(node: unknown): void {
    if (typeof node === "string") {
      const text = node.trim()
      const domainMatch = text.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.wiki\.gg(?:\/.*)?$/i)
      if (domainMatch?.[1]) addEntry(entries, domainMatch[1])
      if ((text.startsWith("[") || text.startsWith("{")) && text.length > 2) {
        try {
          visit(JSON.parse(text))
        } catch {
          // Ignore ordinary strings that only happen to start with a JSON delimiter.
        }
      }
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    if (!node || typeof node !== "object") return

    const object = node as Record<string, unknown>
    const slugCandidate = [object.subdomain, object.slug, object.wiki, object.id]
      .find((item): item is string => typeof item === "string" && Boolean(normalizeSlug(item)))
    const urlCandidate = typeof object.url === "string"
      ? object.url.match(/(?:https?:\/\/)?([a-z0-9-]+)\.wiki\.gg/i)?.[1]
      : undefined
    const slug = slugCandidate ?? urlCandidate
    if (slug) {
      addEntry(entries, slug, typeof object.name === "string" ? object.name : undefined)
    }

    for (const child of Object.values(object)) visit(child)
  }

  visit(value)
  return [...entries.values()]
}

function parseCatalog(text: string): WikiEntry[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith("<")) return parseHtmlCatalog(trimmed)
  try {
    return parseJsonCatalog(JSON.parse(trimmed))
  } catch {
    return parseHtmlCatalog(trimmed)
  }
}

async function fetchCatalog(
  urls: string[],
  context: Parameters<Collector["collect"]>[2],
  minWikiCount: number
): Promise<{ entries: WikiEntry[]; sourceUrl: string }> {
  const errors: string[] = []
  for (const url of urls) {
    try {
      const response = await context.fetch(url, {
        headers: {
          "User-Agent": "auto-site-factory/0.1 (+https://github.com/CoderLim/auto-site-factory)",
          "Accept": "text/html,application/json;q=0.9,*/*;q=0.8"
        }
      })
      if (!response.ok) {
        errors.push(`${url} -> HTTP ${response.status}`)
        continue
      }
      const entries = parseCatalog(await response.text())
      if (entries.length < minWikiCount) {
        errors.push(`${url} -> only ${entries.length} parsed wikis`)
        continue
      }
      return { entries, sourceUrl: url }
    } catch (error) {
      errors.push(`${url} -> ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`wiki.gg catalog unavailable: ${errors.join(" | ")}`)
}

export const wikiGgCollector: Collector = {
  type: "wiki_gg",
  async collect(target, cursor, context) {
    const urls = configStringArray(target.config, "urls", DEFAULT_URLS)
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)
    const maxNewWikis = Math.max(1, configNumber(target.config, "maxNewWikis", 100))
    const minWikiCount = Math.max(1, configNumber(target.config, "minWikiCount", 50))
    const ignoredSlugs = new Set([
      ...DEFAULT_IGNORED_SLUGS,
      ...configStringArray(target.config, "ignoredSlugs").map((value) => value.toLowerCase())
    ])

    const { entries, sourceUrl } = await fetchCatalog(urls, context, minWikiCount)
    const current = entries
      .filter((entry) => !ignoredSlugs.has(entry.slug))
      .sort((a, b) => a.slug.localeCompare(b.slug))
    const previous = Array.isArray(cursor?.wikiSlugs)
      ? cursor.wikiSlugs.filter((item): item is string => typeof item === "string")
      : undefined
    const previousSet = new Set(previous ?? [])
    const isFirstRun = previous === undefined
    const newEntries = isFirstRun && baselineOnFirstRun
      ? []
      : current.filter((entry) => !previousSet.has(entry.slug)).slice(0, maxNewWikis)

    const signals = newEntries.map((entry) => {
      const domain = `${entry.slug}.wiki.gg`
      return makeSignal("wiki_gg", target, entry.slug, {
        title: `${entry.name} Wiki added to wiki.gg`,
        content: `New wiki.gg site detected: ${domain}`,
        url: `https://${domain}/`,
        discoveredAt: context.now,
        metadata: {
          directEntity: entry.name,
          entityType: "GAME",
          wikiSlug: entry.slug,
          wikiDomain: domain,
          catalogSource: sourceUrl,
          catalogSize: current.length,
          sourceRole: "discovery"
        }
      })
    })

    return {
      signals,
      nextCursor: {
        wikiSlugs: current.map((entry) => entry.slug),
        catalogSize: current.length,
        catalogSource: sourceUrl,
        checkedAt: context.now.toISOString(),
        baselineEstablished: isFirstRun && baselineOnFirstRun
      }
    }
  }
}

export { parseCatalog }
