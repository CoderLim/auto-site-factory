import type { Collector } from "@factory/shared"
import { configNumber, configString, envFromConfig, makeSignal } from "./base.js"

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

export const youtubeCollector: Collector = {
  type: "youtube",
  async collect(target, cursor, context) {
    const apiKey = envFromConfig(target.config, "apiKeyEnv")
    const configuredChannelId = configString(target.config, "channelId")
    const handle = configString(target.config, "handle")
    if (!configuredChannelId && !handle) {
      throw new Error("YouTube target requires channelId or handle")
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
        metadata: { channelId, handle, uploadsPlaylistId }
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
