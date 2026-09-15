import type { Collector } from "@factory/shared"
import { configBoolean, configNumber, configString, configStringArray, makeSignal, requireConfigString } from "./base.js"

type FeedEntry = {
  id: string
  title: string
  link?: string
  content?: string
  author?: string
  publishedAt?: Date
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
}

function stripTags(value: string): string {
  return decodeXml(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function firstTag(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"))
    if (match?.[1]) return decodeXml(match[1]).trim()
  }
  return undefined
}

function atomLink(block: string): string | undefined {
  const alternate = block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)
    ?? block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)
  if (alternate?.[1]) return decodeXml(alternate[1]).trim()
  const rssLink = firstTag(block, ["link"])
  return rssLink?.trim()
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseFeed(xml: string): FeedEntry[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
  return blocks.flatMap((match) => {
    const block = match[2] ?? ""
    const title = stripTags(firstTag(block, ["title"]) ?? "")
    if (!title) return []

    const link = atomLink(block)
    const id = stripTags(firstTag(block, ["guid", "id", "yt:videoId"]) ?? link ?? title)
    if (!id) return []

    const rawContent = firstTag(block, ["content:encoded", "content", "description", "summary"])
    const author = stripTags(firstTag(block, ["dc:creator", "name", "author"]) ?? "") || undefined
    const publishedAt = parseDate(firstTag(block, ["pubDate", "published", "updated", "dc:date"]))

    return [{
      id,
      title,
      link,
      content: rawContent ? stripTags(rawContent).slice(0, 4000) : undefined,
      author,
      publishedAt
    }]
  })
}

function cursorSeenIds(cursor: Record<string, unknown> | undefined): string[] {
  const value = cursor?.seenIds
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function stripTrailingBracketMetadata(title: string): string {
  return title.replace(/(?:\s+\[[^\]]+\])+\s*$/g, "").trim()
}

function matchesTitleIncludes(title: string, includes: string[]): boolean {
  if (includes.length === 0) return true
  const normalized = title.toLowerCase()
  return includes.some((value) => normalized.includes(value.toLowerCase()))
}

function isFreshEnough(entry: FeedEntry, now: Date, maxAgeHours: number): boolean {
  if (maxAgeHours <= 0) return true
  if (!entry.publishedAt) return false
  const ageHours = (now.getTime() - entry.publishedAt.getTime()) / (60 * 60 * 1000)
  return ageHours >= -1 && ageHours <= maxAgeHours
}

export const rssCollector: Collector = {
  type: "rss",
  async collect(target, cursor, context) {
    const feedUrl = requireConfigString(target.config, "feedUrl")
    const maxItems = Math.min(100, Math.max(1, configNumber(target.config, "maxItems", 50)))
    const historyLimit = Math.min(1000, Math.max(maxItems, configNumber(target.config, "historyLimit", 300)))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)
    const platform = configString(target.config, "platform", "rss")
    const sourceRole = configString(target.config, "sourceRole", "discovery")
    const directEntity = configBoolean(target.config, "directEntity", false)
    const entityType = configString(target.config, "entityType", "OTHER")
    const directEntityStripBracketSuffix = configBoolean(target.config, "directEntityStripBracketSuffix", false)
    const titleIncludes = configStringArray(target.config, "titleIncludes")
    const maxAgeHours = Math.max(0, configNumber(target.config, "maxAgeHours", 0))

    const response = await context.fetch(feedUrl, {
      headers: {
        "User-Agent": "auto-site-factory/0.1 (+https://github.com/CoderLim/auto-site-factory)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
      }
    })
    if (!response.ok) throw new Error(`RSS ${response.status}: ${feedUrl}`)
    const xml = await response.text()
    const entries = parseFeed(xml)
      .filter((entry) => matchesTitleIncludes(entry.title, titleIncludes))
      .filter((entry) => isFreshEnough(entry, context.now, maxAgeHours))
      .slice(0, maxItems)
    const previousSeenIds = cursorSeenIds(cursor)
    const seen = new Set(previousSeenIds)
    const isFirstRun = !Array.isArray(cursor?.seenIds)

    if (isFirstRun && baselineOnFirstRun) {
      return {
        signals: [],
        nextCursor: { seenIds: entries.map((entry) => entry.id).slice(0, historyLimit) }
      }
    }

    const signals = entries
      .filter((entry) => !seen.has(entry.id))
      .map((entry) => {
        const directName = directEntityStripBracketSuffix
          ? stripTrailingBracketMetadata(entry.title)
          : entry.title
        return makeSignal("rss", target, entry.id, {
          title: entry.title,
          content: entry.content,
          author: entry.author,
          url: entry.link,
          publishedAt: entry.publishedAt,
          discoveredAt: context.now,
          metadata: {
            feedUrl,
            platform,
            sourceRole,
            ...(directEntity ? { directEntity: directName, entityType } : {})
          }
        })
      })

    return {
      signals,
      nextCursor: {
        seenIds: [...entries.map((entry) => entry.id), ...previousSeenIds].slice(0, historyLimit)
      }
    }
  }
}

export { parseFeed, stripTrailingBracketMetadata }
