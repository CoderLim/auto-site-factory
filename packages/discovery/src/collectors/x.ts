import type { Collector } from "@factory/shared"
import { configNumber, envFromConfig, makeSignal, requireConfigString } from "./base.js"

interface XPost {
  id: string
  text: string
  created_at?: string
}

export const xCollector: Collector = {
  type: "x",
  async collect(target, cursor, context) {
    const userId = requireConfigString(target.config, "userId")
    const token = envFromConfig(target.config, "bearerTokenEnv")
    const maxResults = Math.min(100, Math.max(5, configNumber(target.config, "maxResults", 20)))
    const params = new URLSearchParams({
      max_results: String(maxResults),
      "tweet.fields": "created_at,author_id",
      exclude: "retweets,replies"
    })
    if (typeof cursor?.sinceId === "string" && cursor.sinceId) {
      params.set("since_id", cursor.sinceId)
    }
    const response = await context.fetch(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) throw new Error(`X ${response.status}`)
    const payload = await response.json() as { data?: XPost[] }
    const posts = payload.data ?? []
    const signals = posts.map((post) => makeSignal("x", target, post.id, {
      title: post.text,
      content: post.text,
      url: `https://x.com/i/web/status/${post.id}`,
      publishedAt: post.created_at ? new Date(post.created_at) : undefined,
      discoveredAt: context.now,
      metadata: { userId }
    }))
    const newestId = posts.map((post) => post.id).sort((a, b) => BigInt(a) > BigInt(b) ? 1 : -1).at(-1)
    return { signals, nextCursor: { sinceId: newestId ?? cursor?.sinceId ?? "" } }
  }
}
