import type { Collector } from "@factory/shared"
import { configNumber, envFromConfig, makeSignal, requireConfigString } from "./base.js"

interface YouTubeItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
  }
}

export const youtubeCollector: Collector = {
  type: "youtube",
  async collect(target, cursor, context) {
    const channelId = requireConfigString(target.config, "channelId")
    const apiKey = envFromConfig(target.config, "apiKeyEnv")
    const maxResults = Math.min(50, Math.max(1, configNumber(target.config, "maxResults", 25)))
    const cursorPublishedAfter = typeof cursor?.publishedAfter === "string"
      ? cursor.publishedAfter
      : new Date(context.now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    const publishedAfter = new Date(
      new Date(cursorPublishedAfter).getTime() - 10 * 60 * 1000
    ).toISOString()
    const params = new URLSearchParams({
      key: apiKey,
      channelId,
      part: "snippet",
      order: "date",
      type: "video",
      maxResults: String(maxResults),
      publishedAfter
    })
    const response = await context.fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
    if (!response.ok) throw new Error(`YouTube ${response.status}`)
    const payload = await response.json() as { items?: YouTubeItem[] }
    const items = payload.items ?? []
    const signals = items.flatMap((item) => {
      const videoId = item.id?.videoId
      const snippet = item.snippet
      if (!videoId || !snippet?.title) return []
      return [makeSignal("youtube", target, videoId, {
        title: snippet.title,
        content: snippet.description,
        author: snippet.channelTitle,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt: snippet.publishedAt ? new Date(snippet.publishedAt) : undefined,
        discoveredAt: context.now,
        metadata: { channelId }
      })]
    })
    const newest = items
      .map((item) => item.snippet?.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)
    return { signals, nextCursor: { publishedAfter: newest ?? cursorPublishedAfter } }
  }
}
