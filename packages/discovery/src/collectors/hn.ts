import type { Collector } from "@factory/shared"
import { configBoolean, configNumber, configStringArray, makeSignal } from "./base.js"

type HnItem = {
  id?: number
  type?: string
  by?: string
  time?: number
  title?: string
  text?: string
  url?: string
  score?: number
  descendants?: number
}

function seenIdsFromCursor(cursor: Record<string, unknown> | undefined): Set<number> {
  const value = cursor?.seenIds
  if (!Array.isArray(value)) return new Set()
  return new Set(value.filter((item): item is number => typeof item === "number" && Number.isFinite(item)))
}

export const hnCollector: Collector = {
  type: "hn",
  async collect(target, cursor, context) {
    const feed = String(target.config.feed ?? "newstories")
    const maxItems = Math.min(300, Math.max(1, configNumber(target.config, "maxItems", 100)))
    const historyLimit = Math.min(1000, Math.max(maxItems, configNumber(target.config, "historyLimit", 500)))
    const minScore = Math.max(0, configNumber(target.config, "minScore", 0))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)
    const titlePrefixes = configStringArray(target.config, "titlePrefixes").map((value) => value.toLowerCase())

    const response = await context.fetch(`https://hacker-news.firebaseio.com/v0/${feed}.json`)
    if (!response.ok) throw new Error(`Hacker News ${feed} ${response.status}`)
    const ids = (await response.json() as unknown[])
      .filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      .slice(0, maxItems)

    const seenIds = seenIdsFromCursor(cursor)
    const isFirstRun = !Array.isArray(cursor?.seenIds)
    const newIds = ids.filter((id) => !seenIds.has(id))

    if (isFirstRun && baselineOnFirstRun) {
      return {
        signals: [],
        nextCursor: { seenIds: ids.slice(0, historyLimit) }
      }
    }

    const items = await Promise.all(newIds.map(async (id): Promise<HnItem | undefined> => {
      const itemResponse = await context.fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      if (!itemResponse.ok) return undefined
      return await itemResponse.json() as HnItem
    }))

    const signals = items.flatMap((item) => {
      if (!item?.id || item.type !== "story" || !item.title) return []
      if ((item.score ?? 0) < minScore) return []
      if (titlePrefixes.length > 0 && !titlePrefixes.some((prefix) => item.title!.toLowerCase().startsWith(prefix))) {
        return []
      }

      return [makeSignal("hn", target, String(item.id), {
        title: item.title,
        content: item.text,
        author: item.by,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        publishedAt: item.time ? new Date(item.time * 1000) : undefined,
        discoveredAt: context.now,
        metadata: {
          feed,
          score: item.score ?? 0,
          comments: item.descendants ?? 0,
          discussionUrl: `https://news.ycombinator.com/item?id=${item.id}`
        }
      })]
    })

    const mergedSeenIds = [...ids, ...seenIds].slice(0, historyLimit)
    return {
      signals,
      nextCursor: { seenIds: mergedSeenIds }
    }
  }
}
