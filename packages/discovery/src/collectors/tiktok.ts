import type { Collector, RawSignal } from "@factory/shared"
import {
  configBoolean,
  configNumber,
  configString,
  envFromConfig,
  makeSignal
} from "./base.js"

type TikTokAuthor = {
  uniqueId?: string
  nickname?: string
  verified?: boolean
}

type TikTokStats = {
  playCount?: number | string
  diggCount?: number | string
  commentCount?: number | string
  shareCount?: number | string
  collectCount?: number | string
}

type TikTokMusic = {
  id?: string
  title?: string
  authorName?: string
}

type TikTokChallenge = {
  id?: string
  title?: string
}

type TikTokTrendingItem = {
  id?: string
  desc?: string
  createTime?: number | string
  author?: TikTokAuthor
  stats?: TikTokStats
  music?: TikTokMusic
  challenges?: TikTokChallenge[]
  _rank?: number
  _source?: string
  _scrapedAt?: string
  _warning?: string
  _warningDetail?: string
}

function seenIdsFromCursor(cursor: Record<string, unknown> | undefined): string[] {
  const value = cursor?.seenIds
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && Boolean(item))
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value)
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return undefined
}

function publishedAt(value: TikTokTrendingItem["createTime"]): Date | undefined {
  if (value == null) return undefined
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value > 10_000_000_000 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date
  }

  const text = String(value).trim()
  if (!text) return undefined
  if (/^\d+$/.test(text)) {
    const numeric = Number(text)
    if (Number.isFinite(numeric)) {
      const date = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
      return Number.isNaN(date.getTime()) ? undefined : date
    }
  }

  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const tiktokCollector: Collector = {
  type: "tiktok",

  async collect(target, cursor, context) {
    const actorId = configString(
      target.config,
      "actorId",
      "xtracto~tiktok-trending-scraper"
    )
    const token = envFromConfig(target.config, "tokenEnv")
    const countryCode = configString(target.config, "countryCode", "US").toUpperCase()
    const maxItems = Math.min(500, Math.max(1, configNumber(target.config, "maxItems", 50)))
    const historyLimit = Math.min(
      5000,
      Math.max(maxItems, configNumber(target.config, "historyLimit", 500))
    )
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", false)
    const snapshotExisting = configBoolean(target.config, "snapshotExisting", true)
    const sourceRole = configString(target.config, "sourceRole", "discovery")
    const previousSeenIds = seenIdsFromCursor(cursor)
    const seen = new Set(previousSeenIds)
    const isFirstRun = !Array.isArray(cursor?.seenIds)

    const params = new URLSearchParams({ token })
    const endpoint =
      `https://api.apify.com/v2/actors/${actorId}/run-sync-get-dataset-items?${params}`

    const response = await context.fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content_type: "video",
        country_code: countryCode,
        limit: maxItems
      })
    })

    if (!response.ok) {
      throw new Error(`TikTok Apify actor failed with HTTP ${response.status}`)
    }

    const payload = await response.json() as unknown
    if (!Array.isArray(payload)) {
      throw new Error("TikTok Apify actor returned a non-array dataset")
    }

    const items = payload.filter(
      (item): item is TikTokTrendingItem => Boolean(item && typeof item === "object")
    )
    const warning = items.find((item) => item._warning)
    if (warning) {
      throw new Error(
        `TikTok actor warning: ${warning._warning}${warning._warningDetail ? ` - ${warning._warningDetail}` : ""}`
      )
    }

    const unique = new Map<string, TikTokTrendingItem>()
    for (const item of items) {
      const id = typeof item.id === "string" ? item.id.trim() : ""
      if (id && !unique.has(id)) unique.set(id, item)
    }
    if (unique.size === 0) throw new Error("TikTok actor returned no video items")

    const signals: RawSignal[] = []
    for (const [id, item] of unique) {
      const alreadySeen = seen.has(id)
      if (isFirstRun && baselineOnFirstRun) continue
      if (alreadySeen && !snapshotExisting) continue

      const caption = typeof item.desc === "string" ? item.desc.trim() : ""
      const username = item.author?.uniqueId?.trim()
      const nickname = item.author?.nickname?.trim()
      const hashtags = (item.challenges ?? [])
        .map((challenge) => challenge.title?.trim())
        .filter((value): value is string => Boolean(value))
      const hashtagText = hashtags.map((value) => `#${value}`).join(" ")
      const musicTitle = item.music?.title?.trim()
      const musicLine = musicTitle
        ? `Music: ${musicTitle}${item.music?.authorName ? ` — ${item.music.authorName}` : ""}`
        : ""
      const content = [caption, hashtagText, musicLine].filter(Boolean).join("\n")
      const stats = item.stats ?? {}

      signals.push(makeSignal("tiktok", target, id, {
        title: caption.slice(0, 300) || (username ? `TikTok by @${username}` : `TikTok ${id}`),
        content: content || undefined,
        author: username || nickname,
        url: username
          ? `https://www.tiktok.com/@${encodeURIComponent(username)}/video/${id}`
          : undefined,
        publishedAt: publishedAt(item.createTime),
        discoveredAt: context.now,
        metadata: {
          platform: "tiktok",
          sourceRole,
          transport: "apify",
          provider: "apify",
          actorId,
          countryCode,
          rank: numberValue(item._rank),
          views: numberValue(stats.playCount),
          likes: numberValue(stats.diggCount),
          comments: numberValue(stats.commentCount),
          shares: numberValue(stats.shareCount),
          saves: numberValue(stats.collectCount),
          hashtags,
          musicId: item.music?.id,
          musicTitle,
          musicAuthor: item.music?.authorName,
          verifiedAuthor: item.author?.verified,
          snapshotExisting: alreadySeen,
          scrapedAt: item._scrapedAt,
          feedSource: item._source
        }
      }))
    }

    const currentIds = [...unique.keys()]
    const mergedSeenIds = [...new Set([...currentIds, ...previousSeenIds])].slice(0, historyLimit)

    return {
      signals,
      nextCursor: {
        seenIds: mergedSeenIds,
        countryCode,
        lastScrapedAt: context.now.toISOString()
      }
    }
  }
}
