import type { Collector, RawSignal } from "@factory/shared"
import { configBoolean, configNumber, configString, makeSignal, requireConfigString } from "./base.js"

interface RedditChild {
  data?: {
    id?: string
    name?: string
    title?: string
    selftext?: string
    author?: string
    created_utc?: number
    permalink?: string
    url?: string
    url_overridden_by_dest?: string
    domain?: string
    score?: number
    ups?: number
    num_comments?: number
    upvote_ratio?: number
    num_crossposts?: number
    is_self?: boolean
  }
}

function validListing(value: string): "new" | "rising" | "hot" {
  return value === "rising" || value === "hot" ? value : "new"
}

export const redditCollector: Collector = {
  type: "reddit",
  async collect(target, cursor, context) {
    const subreddit = requireConfigString(target.config, "subreddit")
    const tokenEnv = configString(target.config, "tokenEnv")
    const token = tokenEnv ? process.env[tokenEnv]?.trim() : undefined
    const userAgentEnv = configString(target.config, "userAgentEnv")
    const configuredUserAgent = userAgentEnv ? process.env[userAgentEnv]?.trim() : undefined
    const userAgent = configuredUserAgent
      || configString(target.config, "userAgent", "auto-site-factory/0.1 (+https://github.com/CoderLim/auto-site-factory)")
    const listing = validListing(configString(target.config, "listing", "new"))
    const limit = Math.min(100, Math.max(1, configNumber(target.config, "limit", 100)))
    const maxPages = Math.min(10, Math.max(1, configNumber(target.config, "maxPages", 3)))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", false)
    const platform = configString(target.config, "platform", "reddit")
    const sourceRole = configString(target.config, "sourceRole", "discovery")
    const lastSeenFullname = typeof cursor?.lastSeenFullname === "string" ? cursor.lastSeenFullname : undefined

    const signals: RawSignal[] = []
    let after: string | undefined
    let newestFullname: string | undefined
    let reachedPreviousCursor = false
    const isFirstRun = !lastSeenFullname

    for (let page = 0; page < maxPages && !reachedPreviousCursor; page += 1) {
      const params = new URLSearchParams({ limit: String(limit), raw_json: "1" })
      if (after) params.set("after", after)
      const baseUrl = token ? "https://oauth.reddit.com" : "https://www.reddit.com"
      const response = await context.fetch(
        `${baseUrl}/r/${encodeURIComponent(subreddit)}/${listing}${token ? "" : ".json"}?${params}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "User-Agent": userAgent,
            Accept: "application/json"
          }
        }
      )
      if (!response.ok) throw new Error(`Reddit ${response.status}: r/${subreddit}/${listing}`)
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
        if (isFirstRun && baselineOnFirstRun) continue

        const outboundUrl = post.url_overridden_by_dest
          || (!post.is_self && post.url && !post.url.includes("reddit.com/") ? post.url : undefined)
        signals.push(makeSignal("reddit", target, post.id, {
          title: post.title,
          content: post.selftext,
          author: post.author,
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : undefined,
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
          discoveredAt: context.now,
          metadata: {
            platform,
            sourceRole,
            subreddit,
            listing,
            score: post.score ?? 0,
            ups: post.ups ?? 0,
            numComments: post.num_comments ?? 0,
            upvoteRatio: post.upvote_ratio,
            numCrossposts: post.num_crossposts ?? 0,
            domain: post.domain,
            outboundUrl,
            isSelf: post.is_self ?? false
          }
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
