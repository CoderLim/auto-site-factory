import type { Collector } from "@factory/shared"
import { configNumber, configString, envFromConfig, makeSignal } from "./base.js"

interface XPost {
  id: string
  text: string
  created_at?: string
}

async function resolveUserId(
  username: string,
  token: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const response = await fetchImpl(
    `https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!response.ok) throw new Error(`X user lookup ${response.status}: @${username}`)
  const payload = await response.json() as { data?: { id?: string } }
  if (!payload.data?.id) throw new Error(`X user not found: @${username}`)
  return payload.data.id
}

export const xCollector: Collector = {
  type: "x",
  async collect(target, cursor, context) {
    const token = envFromConfig(target.config, "bearerTokenEnv")
    const configuredUserId = configString(target.config, "userId")
    const username = configString(target.config, "username")
    if (!configuredUserId && !username) {
      throw new Error("X target requires userId or username")
    }

    let userId = configuredUserId
    if (!userId && typeof cursor?.resolvedUserId === "string" && cursor.resolvedUserId) {
      userId = cursor.resolvedUserId
    }
    if (!userId) userId = await resolveUserId(username, token, context.fetch)

    const maxResults = Math.min(100, Math.max(5, configNumber(target.config, "maxResults", 20)))
    const params = new URLSearchParams({
      max_results: String(maxResults),
      "tweet.fields": "created_at,author_id",
      exclude: "retweets,replies"
    })
    if (typeof cursor?.sinceId === "string" && cursor.sinceId) {
      params.set("since_id", cursor.sinceId)
    }

    const response = await context.fetch(
      `https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!response.ok) throw new Error(`X timeline ${response.status}: ${username || userId}`)
    const payload = await response.json() as { data?: XPost[] }
    const posts = payload.data ?? []

    const signals = posts.map((post) => makeSignal("x", target, post.id, {
      title: post.text,
      content: post.text,
      url: username
        ? `https://x.com/${encodeURIComponent(username)}/status/${post.id}`
        : `https://x.com/i/web/status/${post.id}`,
      publishedAt: post.created_at ? new Date(post.created_at) : undefined,
      discoveredAt: context.now,
      metadata: { userId, username }
    }))

    const newestId = posts
      .map((post) => post.id)
      .sort((a, b) => BigInt(a) > BigInt(b) ? 1 : -1)
      .at(-1)

    return {
      signals,
      nextCursor: {
        ...cursor,
        resolvedUserId: userId,
        sinceId: newestId ?? cursor?.sinceId ?? ""
      }
    }
  }
}
