import type { Collector, SignalSourceType } from "@factory/shared"
import { officialApiCollector } from "./official-api.js"
import { redditCollector } from "./reddit.js"
import { sitemapCollector } from "./sitemap.js"
import { wikiCollector } from "./wiki.js"
import { xCollector } from "./x.js"
import { youtubeCollector } from "./youtube.js"

const collectors: Partial<Record<SignalSourceType, Collector>> = {
  official_api: officialApiCollector,
  wiki: wikiCollector,
  reddit: redditCollector,
  youtube: youtubeCollector,
  x: xCollector,
  sitemap: sitemapCollector
}

export function getCollector(type: SignalSourceType): Collector | undefined {
  return collectors[type]
}

export * from "./sitemap.js"
