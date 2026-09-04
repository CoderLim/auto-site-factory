import type { Collector, SignalSourceType } from "@factory/shared"
import { hnCollector } from "./hn.js"
import { officialApiCollector } from "./official-api.js"
import { redditCollector } from "./reddit.js"
import { rssCollector } from "./rss.js"
import { sitemapCollector } from "./sitemap.js"
import { twitchCollector } from "./twitch.js"
import { wikiCollector } from "./wiki.js"
import { wikiGgCollector } from "./wiki-gg.js"
import { xCollector } from "./x.js"
import { youtubeCollector } from "./youtube.js"

const collectors: Partial<Record<SignalSourceType, Collector>> = {
  official_api: officialApiCollector,
  wiki: wikiCollector,
  wiki_gg: wikiGgCollector,
  reddit: redditCollector,
  youtube: youtubeCollector,
  twitch: twitchCollector,
  hn: hnCollector,
  rss: rssCollector,
  x: xCollector,
  sitemap: sitemapCollector
}

export function getCollector(type: SignalSourceType): Collector | undefined {
  return collectors[type]
}

export * from "./hn.js"
export * from "./rss.js"
export * from "./sitemap.js"
export * from "./twitch.js"
export * from "./wiki-gg.js"
