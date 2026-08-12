import { getPath, type Collector } from "@factory/shared"
import {
  configString,
  envFromConfig,
  makeSignal,
  requireConfigString
} from "./base.js"

export const officialApiCollector: Collector = {
  type: "official_api",
  async collect(target, cursor, context) {
    const url = requireConfigString(target.config, "url")
    const tokenEnv = configString(target.config, "tokenEnv")
    const headers: Record<string, string> = { Accept: "application/json" }
    if (tokenEnv) headers.Authorization = `Bearer ${envFromConfig(target.config, "tokenEnv")}`

    const response = await context.fetch(url, { headers })
    if (!response.ok) throw new Error(`Official API ${response.status}: ${url}`)
    const payload = await response.json() as unknown
    const itemsPath = configString(target.config, "itemsPath")
    const itemsValue = getPath(payload, itemsPath)
    const items = Array.isArray(itemsValue) ? itemsValue : Array.isArray(payload) ? payload : []

    const idField = configString(target.config, "idField", "id")
    const nameField = configString(target.config, "nameField", "name")
    const publishedAtField = configString(target.config, "publishedAtField", "created_at")
    const lastPublishedAt = typeof cursor?.lastPublishedAt === "string" ? cursor.lastPublishedAt : undefined

    const signals = items.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      const id = record[idField]
      const name = record[nameField]
      if ((typeof id !== "string" && typeof id !== "number") || typeof name !== "string") return []
      const publishedValue = record[publishedAtField]
      const publishedAt = typeof publishedValue === "string" ? new Date(publishedValue) : undefined
      if (lastPublishedAt && publishedAt && publishedAt.toISOString() <= lastPublishedAt) return []
      return [makeSignal("official_api", target, String(id), {
        title: name,
        content: JSON.stringify(record),
        publishedAt,
        discoveredAt: context.now,
        metadata: {
          directEntity: name,
          entityType: configString(target.config, "entityType", "OTHER"),
          raw: record
        }
      })]
    })

    const newest = signals
      .map((signal) => signal.publishedAt?.toISOString())
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)

    return {
      signals,
      nextCursor: { ...cursor, ...(newest ? { lastPublishedAt: newest } : {}) }
    }
  }
}
