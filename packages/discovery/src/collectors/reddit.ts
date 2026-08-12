import type { Collector, RawSignal } from "@factory/shared"
import { configNumber, configString, envFromConfig, makeSignal, requireConfigString } from "./base.js"

interface RedditChild {
  data?: {
    id?: string
    name?: string
    title?: string
    selftext?: string
    author?: string
    created_utc?: number
    permalink?: string
  }
}

export const redditCollector: Collector = {
  type: "reddit",
  async collect(target, cursor, context) {
    const subreddit = requireConfigString(target.config, "subreddit")
    const token = envFromConfig(target.config, "tokenEnv")
    const userAgentEnv = configString(target.config, "userAgentEnv")
    const userAgent = userAgentEnv ? process.env[userAgentEnv] : undefined
    const limit = Math.min(100, Math.max(1, configNumber(target.config, "limit", 100)))
    const maxPages = Math.min(10, Math.max(1, configNumber(target.config, "maxPages", 5)))
    const lastSeenFullname = typeof cursor?.lastSeenFullname === "string" ? cursor.lastSeenFullname : undefined

    const signals: RawSignal[] = []
    let after: string | undefined
    let newestFullname: string | undefined
    let reachedPreviousCursor = false

    for (let page = 0; page < maxPages && !reachedPreviousCursor; page += 1) {
      const params = new URLSearchParams({ limit: String(limit), raw_json: "1" })
      if (after) params.set("after", after)
      const response = await context.fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(userAgent ? { "User-Agent": userAgent } : {})
        }
      })
      if (!response.ok) throw new Error(`Reddit ${response.status}`)
      const payload = await response.json() as { data?: { children?: RedditChild[]; after?: string | null } }
      const children = payload.data?.children ?? []
      if (!newestFullname) newestFullname = children[0]?.data?.name

      for (const child of children) {
        const post = child.data
        if (!post?.id || !post.title) continue
        if (lastSeenFullname && post.name === lastSeenFullname) {
          reachedPreviousCursor = true
          break
        }
        signals.push(makeSignal("reddit", target, post.id, {
          title: post.title,
          content: post.selftext,
          author: post.author,
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : undefined,
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
          discoveredAt: context.now,
          metadata: { subreddit }
        }))
      }

      after = payload.data?.after ?? undefined
      if (!after) break
    }

    return {
      signals,
      nextCursor: { lastSeenFullname: newestFullname ?? lastSeenFullname ?? "" }
    }
  }
}
