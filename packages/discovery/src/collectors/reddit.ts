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

interface ArcticShiftPost {
  id?: string
  title?: string
  selftext?: string
  author?: string
  subreddit?: string
  created_utc?: number
  url?: string
  score?: number
  num_comments?: number
  over_18?: boolean
}

let keylessFetchChain: Promise<void> = Promise.resolve()
let nextKeylessFetchAt = 0

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function pacedKeylessFetch(
  context: Parameters<Collector["collect"]>[2],
  url: string,
  init: RequestInit,
  intervalMs: number
): Promise<Response> {
  let release!: () => void
  const previous = keylessFetchChain
  keylessFetchChain = new Promise<void>((resolve) => { release = resolve })
  await previous

  try {
    const waitMs = Math.max(0, nextKeylessFetchAt - Date.now())
    if (waitMs > 0) await sleep(waitMs)
    const response = await context.fetch(url, init)
    nextKeylessFetchAt = Date.now() + intervalMs
    return response
  } finally {
    release()
  }
}

function retryDelayMs(response: Response): number {
  const retryAfter = response.headers.get("retry-after")
  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000)
  }
  const reset = response.headers.get("x-ratelimit-reset")
  if (reset) {
    const seconds = Number(reset)
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000)
  }
  return 2_000
}

async function fetchRedditFeed(
  context: Parameters<Collector["collect"]>[2],
  urls: string[],
  userAgent: string,
  intervalMs: number
): Promise<{ response: Response; feedUrl: string }> {
  let lastStatus = 0

  for (const feedUrl of urls) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await pacedKeylessFetch(context, feedUrl, {
        headers: {
          "User-Agent": userAgent,
          Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }, intervalMs)

      if (response.ok) return { response, feedUrl }
      lastStatus = response.status
      if (response.status !== 429) break
      if (attempt === 0) await sleep(retryDelayMs(response))
    }
  }

  throw new Error(`Reddit RSS ${lastStatus || "failed"}`)
}

async function collectRssKeyless(input: {
  subreddit: string
  listing: "new" | "rising" | "hot"
  limit: number
  historyLimit: number
  baselineOnFirstRun: boolean
  snapshotExisting: boolean
  platform: string
  sourceRole: string
  userAgent: string
  intervalMs: number
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
    intervalMs,
    target,
    cursor,
    context
  } = input

  const encodedSubreddit = encodeURIComponent(subreddit)
  const suffix = `/r/${encodedSubreddit}/${listing}/.rss?limit=${limit}&sort=${listing}`
  const { response, feedUrl } = await fetchRedditFeed(context, [
    `https://www.reddit.com${suffix}`,
    `https://old.reddit.com${suffix}`
  ], userAgent, intervalMs)

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
        transport: "rss",
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

async function collectArcticShiftKeyless(input: {
  subreddit: string
  listing: "new" | "rising" | "hot"
  limit: number
  historyLimit: number
  baselineOnFirstRun: boolean
  snapshotExisting: boolean
  platform: string
  sourceRole: string
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
    target,
    cursor,
    context
  } = input

  const params = new URLSearchParams({
    limit: String(Math.min(100, limit)),
    sort: "desc",
    after: "3d",
    fields: "id,title,selftext,author,subreddit,created_utc,url,score,num_comments,over_18"
  })
  if (subreddit.toLowerCase() !== "all") params.set("subreddit", subreddit)

  const apiUrl = `https://arctic-shift.photon-reddit.com/api/posts/search?${params}`
  const response = await context.fetch(apiUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AutoSiteFactory/0.1 (+https://github.com/CoderLim/auto-site-factory)"
    }
  })
  if (!response.ok) throw new Error(`Arctic Shift ${response.status}: r/${subreddit}/${listing}`)

  const payload = await response.json() as { data?: ArcticShiftPost[] }
  const posts = payload.data ?? []
  const seen = seenFullnamesFromCursor(cursor)
  const isFirstRun = !Array.isArray(cursor?.seenFullnames) && typeof cursor?.lastSeenFullname !== "string"
  const currentFullnames: string[] = []
  const signals: RawSignal[] = []

  for (const post of posts) {
    if (!post.id || !post.title) continue
    const fullname = `t3_${post.id}`
    currentFullnames.push(fullname)

    const alreadySeen = seen.has(fullname)
    if (isFirstRun && baselineOnFirstRun) continue
    if (alreadySeen && !snapshotExisting) continue

    const postSubreddit = post.subreddit || subreddit
    const redditUrl = `https://www.reddit.com/r/${encodeURIComponent(postSubreddit)}/comments/${post.id}/`
    const outboundUrl = post.url && !post.url.includes("reddit.com/") ? post.url : undefined

    signals.push(makeSignal("reddit", target, post.id, {
      title: post.title,
      content: post.selftext,
      author: post.author,
      url: redditUrl,
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : undefined,
      discoveredAt: context.now,
      metadata: {
        platform,
        sourceRole,
        subreddit: postSubreddit,
        listing,
        transport: "arctic-shift",
        archiveApi: apiUrl,
        score: post.score ?? 0,
        numComments: post.num_comments ?? 0,
        outboundUrl,
        over18: post.over_18 ?? false,
        snapshotExisting: alreadySeen,
        degradedListing: subreddit.toLowerCase() === "all" || listing !== "new"
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
      || configString(target.config, "userAgent", "Mozilla/5.0 (compatible; AutoSiteFactory/0.1; +https://github.com/CoderLim/auto-site-factory)")
    const listing = validListing(configString(target.config, "listing", "new"))
    const limit = Math.min(100, Math.max(1, configNumber(target.config, "limit", 100)))
    const maxPages = Math.min(10, Math.max(1, configNumber(target.config, "maxPages", 3)))
    const historyLimit = Math.min(2000, Math.max(limit * maxPages, configNumber(target.config, "historyLimit", 500)))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", false)
    const snapshotExisting = configBoolean(target.config, "snapshotExisting", false)
    const platform = configString(target.config, "platform", "reddit")
    const sourceRole = configString(target.config, "sourceRole", "discovery")
    const keylessIntervalMs = Math.min(10_000, Math.max(0, configNumber(target.config, "keylessIntervalMs", 1100)))

    // Reddit blocks unauthenticated JSON from hosted runners, and can also block RSS
    // from datacenter IP ranges. Prefer Reddit RSS when it works; if Reddit rejects it,
    // fall back to Arctic Shift's public Reddit archive so Viral Radar still receives
    // keyless Reddit signals. OAuth JSON remains the preferred real-time path when a
    // valid token is configured.
    if (!token) {
      try {
        return await collectRssKeyless({
          subreddit,
          listing,
          limit,
          historyLimit,
          baselineOnFirstRun,
          snapshotExisting,
          platform,
          sourceRole,
          userAgent,
          intervalMs: keylessIntervalMs,
          target,
          cursor,
          context
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!/^Reddit RSS (403|429)$/.test(message)) throw error
        return collectArcticShiftKeyless({
          subreddit,
          listing,
          limit,
          historyLimit,
          baselineOnFirstRun,
          snapshotExisting,
          platform,
          sourceRole,
          target,
          cursor,
          context
        })
      }
    }

    const seen = seenFullnamesFromCursor(cursor)
    const isFirstRun = !Array.isArray(cursor?.seenFullnames) && typeof cursor?.lastSeenFullname !== "string"
    const signals: RawSignal[] = []
    const currentFullnames: string[] = []
    let after: string | undefined

    for (let page = 0; page < maxPages; page += 1) {
      const params = new URLSearchParams({ limit: String(limit), raw_json: "1" })
      if (after) params.set("after", after)
      const response = await context.fetch(
        `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/${listing}?${params}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": userAgent,
            Accept: "application/json"
          }
        }
      )
      if (!response.ok) throw new Error(`Reddit OAuth ${response.status}: r/${subreddit}/${listing}`)
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
            transport: "oauth-json",
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
