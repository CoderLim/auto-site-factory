import type { Collector } from "@factory/shared"
import { configNumber, makeSignal, requireConfigString } from "./base.js"

interface RecentChange {
  rcid: number
  type: string
  title: string
  pageid?: number
  revid?: number
  old_revid?: number
  timestamp: string
  comment?: string
  user?: string
  ns?: number
}

export const wikiCollector: Collector = {
  type: "wiki",
  async collect(target, cursor, context) {
    const apiUrl = requireConfigString(target.config, "apiUrl")
    const namespace = configNumber(target.config, "namespace", 0)
    const limit = Math.min(500, Math.max(1, configNumber(target.config, "limit", 50)))
    const previousTimestamp = typeof cursor?.timestamp === "string" ? cursor.timestamp : undefined
    const overlapMs = 10 * 60 * 1000
    const start = previousTimestamp
      ? new Date(new Date(previousTimestamp).getTime() - overlapMs).toISOString()
      : new Date(context.now.getTime() - 6 * 60 * 60 * 1000).toISOString()

    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      list: "recentchanges",
      rcprop: "title|ids|timestamp|comment|user",
      rctype: "new|edit",
      rcnamespace: String(namespace),
      rcdir: "newer",
      rcstart: start,
      rclimit: String(limit)
    })
    const response = await context.fetch(`${apiUrl}?${params}`)
    if (!response.ok) throw new Error(`Wiki ${response.status}: ${apiUrl}`)
    const payload = await response.json() as { query?: { recentchanges?: RecentChange[] } }
    const changes = payload.query?.recentchanges ?? []

    const signals = changes.map((change) =>
      makeSignal("wiki", target, String(change.rcid), {
        title: change.title,
        content: change.comment,
        author: change.user,
        publishedAt: new Date(change.timestamp),
        discoveredAt: context.now,
        url: `${apiUrl.replace(/\/api\.php.*$/, "")}/wiki/${encodeURIComponent(change.title.replace(/ /g, "_"))}`,
        metadata: {
          changeType: change.type,
          pageId: change.pageid,
          revisionId: change.revid,
          oldRevisionId: change.old_revid,
          ...(change.type === "new" ? { directEntity: change.title } : {})
        }
      })
    )

    const newest = changes.map((change) => change.timestamp).sort().at(-1)
    return {
      signals,
      nextCursor: { timestamp: newest ?? previousTimestamp ?? context.now.toISOString() }
    }
  }
}
