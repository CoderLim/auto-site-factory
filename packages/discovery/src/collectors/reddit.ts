import type { Collector, RawSignal } from "@factory/shared"
import { configBoolean, configNumber, configString, makeSignal, requireConfigString } from "./base.js"
import { parseFeed } from "./rss.js"

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

function seenFullnamesFromCursor(cursor: Record<string, unknown> | undefined): Set<string> {
  const many = cursor?.seenFullnames
  const seen = new Set<string>()
  if (Array.isArray(many)) {
    for (const item of many) if (typeof item === "string" && item) seen.add(item)
  }
  const legacy = cursor?.lastSeenFullname
  if (typeof legacy === "string" && legacy) seen.add(legacy)
  return seen
}

function redditIdFromFeed(entryId: string, link?: string): { externalId: string; fullname: string } {
  const fullname = entryId.match(/^t3_[a-z0-9]+$/i)?.[0]
  if (fullname) return { externalId: fullname.slice(3), fullname }

  const linkId = link?.match(/\/comments\/([a-z0-9]+)(?:\/|$)/i)?.[1]
  if (linkId) return { externalId: linkId, fullname: `t3_${linkId}` }

  const stable = entryId.replace(/^https?:\/\//i, "").slice(0, 240)
  return { externalId: stable, fullname: `rss:${stable}` }
}

function redditAuthorFromFeed(author?: string): string | undefined {
  if (!author) return undefined
  return author.replace(/^\/u\//i, "").replace(/^u\//i, "").trim() || undefined
}

async function collectRssFallback(input: {
  subreddit: string
  listing: "new" | "rising" | "hot"
  limit: number
  historyLimit: number
  baselineOnFirstRun: boolean
  snapshotExisting: boolean
  platform: string
  sourceRole: string
  userAgent: string
  target: Parameters<Collector["collect"]>[0]
  cursor: Parameters<Collector["collect"]>[1]
  context: Parameters<Collector["collect"]>[2]
}): Promise<Awaited<ReturnType<Collector["collect"]>>> {
  const {
    subreddit,
    listing,
    limit,
    historyLimit,
    baselineOnFirstRun,
    snapshotExisting,
    platform,
    sourceRole,
    userAgent,
    target,
    cursor,
    context
  } = input

  const feedUrl = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/${listing}/.rss?limit=${limit}`
  const response = await context.fetch(feedUrl, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
    }
  })
  if (!response.ok) throw new Error(`Reddit RSS ${response.status}: r/${subreddit}/${listing}`)

  const entries = parseFeed(await response.text()).slice(0, limit)
  const seen = seenFullnamesFromCursor(cursor)
  const isFirstRun = !Array.isArray(cursor?.seenFullnames) && typeof cursor?.lastSeenFullname !== "string"
  const currentFullnames: string[] = []
  const signals: RawSignal[] = []

  for (const entry of entries) {
    const { externalId, fullname } = redditIdFromFeed(entry.id, entry.link)
    currentFullnames.push(fullname)

    const alreadySeen = seen.has(fullname)
    if (isFirstRun && baselineOnFirstRun) continue
    if (alreadySeen && !snapshotExisting) continue

    signals.push(makeSignal("reddit", target, externalId, {
      title: entry.title,
      content: entry.content,
      author: redditAuthorFromFeed(entry.author),
      url: entry.link,
      publishedAt: entry.publishedAt,
      discoveredAt: context.now,
      metadata: {
        platform,
        sourceRole,
        subreddit,
        listing,
        rssFallback: true,
        feedUrl,
        snapshotExisting: alreadySeen
      }
    }))
  }

  return {
    signals,
    nextCursor: {
      seenFullnames: [...currentFullnames, ...seen].slice(0, historyLimit),
      lastSeenFullname: currentFullnames[0] ?? (typeof cursor?.lastSeenFullname === "string" ? cursor.lastSeenFullname : "")
    }
  }
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
    const historyLimit = Math.min(2000, Math.max(limit * maxPages, configNumber(target.config, "historyLimit", 500)))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", false)
    const snapshotExisting = configBoolean(target.config, "snapshotExisting", false)
    const platform = configString(target.config, "platform", "reddit")
    const sourceRole = configString(target.config, "sourceRole", "discovery")
    const seen = seenFullnamesFromCursor(cursor)
    const isFirstRun = !Array.isArray(cursor?.seenFullnames) && typeof cursor?.lastSeenFullname !== "string"

    const signals: RawSignal[] = []
    const currentFullnames: string[] = []
    let after: string | undefined

    for (let page = 0; page < maxPages; page += 1) {
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

      if (!response.ok) {
        // Reddit increasingly blocks unauthenticated JSON requests from cloud runners.
        // Its current www.reddit.com Atom feeds remain public, so preserve discovery
        // coverage by falling back instead of dropping the entire source.
        if (!token && (response.status === 403 || response.status === 429)) {
          return collectRssFallback({
            subreddit,
            listing,
            limit,
            historyLimit,
            baselineOnFirstRun,
            snapshotExisting,
            platform,
            sourceRole,
            userAgent,
            target,
            cursor,
            context
          })
        }
        throw new Error(`Reddit ${response.status}: r/${subreddit}/${listing}`)
      }

      const payload = await response.json() as { data?: { children?: RedditChild[]; after?: string | null } }
      const children = payload.data?.children ?? []

      for (const child of children) {
        const post = child.data
        if (!post?.id || !post.title || !post.name) continue
        currentFullnames.push(post.name)

        const alreadySeen = seen.has(post.name)
        if (isFirstRun && baselineOnFirstRun) continue
        if (alreadySeen && !snapshotExisting) continue

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
            isSelf: post.is_self ?? false,
            snapshotExisting: alreadySeen
          }
        }))
      }

      after = payload.data?.after ?? undefined
      if (!after) break
    }

    return {
      signals,
      nextCursor: {
        seenFullnames: [...currentFullnames, ...seen].slice(0, historyLimit),
        lastSeenFullname: currentFullnames[0] ?? (typeof cursor?.lastSeenFullname === "string" ? cursor.lastSeenFullname : "")
      }
    }
  }
}
