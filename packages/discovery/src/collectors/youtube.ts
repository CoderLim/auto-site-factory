import type { Collector } from "@factory/shared"
import { configBoolean, configNumber, configString, envFromConfig, makeSignal } from "./base.js"
import { parseFeed } from "./rss.js"

interface YouTubeChannel {
  id?: string
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string
    }
  }
}

interface YouTubePlaylistItem {
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
    resourceId?: { videoId?: string }
  }
  contentDetails?: {
    videoId?: string
  }
}

function laterIso(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function cursorSeenIds(cursor: Record<string, unknown> | undefined): string[] {
  const value = cursor?.seenIds
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

async function collectFromAtomFeed(
  target: Parameters<Collector["collect"]>[0],
  cursor: Parameters<Collector["collect"]>[1],
  context: Parameters<Collector["collect"]>[2],
  channelId: string,
  feedUrl: string
) {
  const maxResults = Math.min(50, Math.max(1, configNumber(target.config, "maxResults", 25)))
  const historyLimit = Math.min(500, Math.max(maxResults, configNumber(target.config, "historyLimit", 200)))
  const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)

  const response = await context.fetch(feedUrl, {
    headers: {
      "User-Agent": "auto-site-factory/0.1 (+https://github.com/CoderLim/auto-site-factory)",
      "Accept": "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
    }
  })
  if (!response.ok) throw new Error(`YouTube Atom feed ${response.status}: ${feedUrl}`)

  const entries = parseFeed(await response.text()).slice(0, maxResults)
  const previousSeenIds = cursorSeenIds(cursor)
  const seen = new Set(previousSeenIds)
  const isFirstRun = !Array.isArray(cursor?.seenIds)

  if (isFirstRun && baselineOnFirstRun) {
    return {
      signals: [],
      nextCursor: {
        channelId,
        seenIds: entries.map((entry) => entry.id).slice(0, historyLimit)
      }
    }
  }

  const signals = entries
    .filter((entry) => !seen.has(entry.id))
    .map((entry) => makeSignal("youtube", target, entry.id, {
      title: entry.title,
      content: entry.content,
      author: entry.author,
      url: entry.link,
      publishedAt: entry.publishedAt,
      discoveredAt: context.now,
      metadata: { channelId, feedUrl, transport: "atom" }
    }))

  return {
    signals,
    nextCursor: {
      channelId,
      seenIds: [...entries.map((entry) => entry.id), ...previousSeenIds].slice(0, historyLimit)
    }
  }
}

export const youtubeCollector: Collector = {
  type: "youtube",
  async collect(target, cursor, context) {
    const configuredChannelId = configString(target.config, "channelId")
    const handle = configString(target.config, "handle")
    const configuredFeedUrl = configString(target.config, "feedUrl")
    const apiKeyEnv = configString(target.config, "apiKeyEnv")

    // Free mode: a channel ID is enough to consume YouTube's public Atom feed.
    // Keep sourceType="youtube" so cross-platform source_count remains meaningful.
    if (configuredFeedUrl || (configuredChannelId && !apiKeyEnv)) {
      const feedUrl = configuredFeedUrl || `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(configuredChannelId)}`
      return collectFromAtomFeed(target, cursor, context, configuredChannelId, feedUrl)
    }

    const apiKey = envFromConfig(target.config, "apiKeyEnv")
    if (!configuredChannelId && !handle) {
      throw new Error("YouTube target requires channelId, handle, or feedUrl")
    }

    const channelParams = new URLSearchParams({
      key: apiKey,
      part: "contentDetails",
      ...(configuredChannelId ? { id: configuredChannelId } : { forHandle: handle })
    })
    const channelResponse = await context.fetch(
      `https://www.googleapis.com/youtube/v3/channels?${channelParams}`
    )
    if (!channelResponse.ok) throw new Error(`YouTube channels ${channelResponse.status}`)
    const channelPayload = await channelResponse.json() as { items?: YouTubeChannel[] }
    const channel = channelPayload.items?.[0]
    const channelId = channel?.id
    const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads
    if (!channelId || !uploadsPlaylistId) {
      throw new Error(`YouTube channel not found: ${configuredChannelId || handle}`)
    }

    const maxResults = Math.min(50, Math.max(1, configNumber(target.config, "maxResults", 25)))
    const cursorPublishedAfter = typeof cursor?.publishedAfter === "string"
      ? cursor.publishedAfter
      : new Date(context.now.getTime() - 6 * 60 * 60 * 1000).toISOString()
    const cutoff = new Date(
      new Date(cursorPublishedAfter).getTime() - 10 * 60 * 1000
    )

    const playlistParams = new URLSearchParams({
      key: apiKey,
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(maxResults)
    })
    const response = await context.fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${playlistParams}`
    )
    if (!response.ok) throw new Error(`YouTube playlistItems ${response.status}`)
    const payload = await response.json() as { items?: YouTubePlaylistItem[] }
    const items = payload.items ?? []

    const signals = items.flatMap((item) => {
      const snippet = item.snippet
      const videoId = item.contentDetails?.videoId ?? snippet?.resourceId?.videoId
      if (!videoId || !snippet?.title) return []

      const publishedAt = snippet.publishedAt ? new Date(snippet.publishedAt) : undefined
      if (publishedAt && publishedAt <= cutoff) return []

      return [makeSignal("youtube", target, videoId, {
        title: snippet.title,
        content: snippet.description,
        author: snippet.channelTitle,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        publishedAt,
        discoveredAt: context.now,
        metadata: { channelId, handle, uploadsPlaylistId, transport: "api" }
      })]
    })

    const newest = items
      .map((item) => item.snippet?.publishedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)

    return {
      signals,
      nextCursor: {
        ...cursor,
        channelId,
        publishedAfter: newest ? laterIso(newest, cursorPublishedAfter) : cursorPublishedAfter
      }
    }
  }
}
