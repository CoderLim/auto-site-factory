import { getPath, type Collector } from "@factory/shared"
import {
  configBoolean,
  configNumber,
  configString,
  configStringArray,
  envFromConfig,
  makeSignal,
  requireConfigString
} from "./base.js"

function firstString(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = getPath(record, field)
    if (typeof value === "string" && value.trim()) return value.trim()
    if (typeof value === "number") return String(value)
  }
  return undefined
}

function transformName(value: string, strategy: string): string {
  if (strategy === "basename") return value.split("/").filter(Boolean).at(-1) ?? value
  return value
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export const officialApiCollector: Collector = {
  type: "official_api",
  async collect(target, cursor, context) {
    const url = requireConfigString(target.config, "url")
    const headers: Record<string, string> = { Accept: "application/json" }
    const configuredHeaders = target.config.headers
    if (configuredHeaders && typeof configuredHeaders === "object" && !Array.isArray(configuredHeaders)) {
      for (const [key, value] of Object.entries(configuredHeaders)) {
        if (typeof value === "string") headers[key] = value
      }
    }
    const tokenEnv = configString(target.config, "tokenEnv")
    if (tokenEnv) {
      const scheme = configString(target.config, "tokenScheme", "Bearer")
      headers.Authorization = `${scheme} ${envFromConfig(target.config, "tokenEnv")}`.trim()
    }

    const response = await context.fetch(url, { headers })
    if (!response.ok) throw new Error(`Official API ${response.status}: ${url}`)
    const payload = await response.json() as unknown
    const itemsPath = configString(target.config, "itemsPath")
    const itemsValue = itemsPath ? getPath(payload, itemsPath) : payload
    const items = Array.isArray(itemsValue) ? itemsValue : Array.isArray(payload) ? payload : []

    const idField = configString(target.config, "idField", "id")
    const configuredNameFields = configStringArray(target.config, "nameFields")
    const nameFields = configuredNameFields.length > 0
      ? configuredNameFields
      : [configString(target.config, "nameField", "name")]
    const publishedAtField = configString(target.config, "publishedAtField", "created_at")
    const contentField = configString(target.config, "contentField")
    const urlField = configString(target.config, "urlField")
    const authorField = configString(target.config, "authorField")
    const includeField = configString(target.config, "includeField")
    const includeValues = new Set(configStringArray(target.config, "includeValues"))
    const directEntity = configBoolean(target.config, "directEntity", true)
    const nameTransform = configString(target.config, "nameTransform", "identity")
    const overlapMinutes = Math.max(0, configNumber(target.config, "cursorOverlapMinutes", 10))
    const baselineOnFirstRun = configBoolean(target.config, "baselineOnFirstRun", true)
    const platform = configString(target.config, "platform", target.sourceType)
    const sourceRole = configString(target.config, "sourceRole", "discovery")

    const lastPublishedAt = typeof cursor?.lastPublishedAt === "string" ? cursor.lastPublishedAt : undefined
    const cutoff = lastPublishedAt
      ? new Date(new Date(lastPublishedAt).getTime() - overlapMinutes * 60 * 1000)
      : undefined

    const candidateSignals = items.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const record = item as Record<string, unknown>
      if (includeField && includeValues.size > 0) {
        const filterValue = getPath(record, includeField)
        if (!includeValues.has(String(filterValue ?? ""))) return []
      }

      const id = getPath(record, idField)
      const rawName = firstString(record, nameFields)
      if ((typeof id !== "string" && typeof id !== "number") || !rawName) return []
      const name = transformName(rawName, nameTransform)
      const publishedAt = parseDate(getPath(record, publishedAtField))
      if (cutoff && publishedAt && publishedAt <= cutoff) return []
      const contentValue = contentField ? getPath(record, contentField) : undefined
      const content = typeof contentValue === "string" ? contentValue : JSON.stringify(record)
      const urlValue = urlField ? getPath(record, urlField) : undefined
      const signalUrl = typeof urlValue === "string" ? urlValue : undefined
      const authorValue = authorField ? getPath(record, authorField) : undefined
      const author = typeof authorValue === "string" && authorValue.trim() ? authorValue.trim() : undefined
      return [makeSignal("official_api", target, String(id), {
        title: name,
        content,
        author,
        url: signalUrl,
        publishedAt,
        discoveredAt: context.now,
        metadata: {
          platform,
          sourceRole,
          ...(directEntity ? { directEntity: name, entityType: configString(target.config, "entityType", "OTHER") } : {}),
          rawEntityName: rawName,
          raw: record
        }
      })]
    })

    const newest = candidateSignals
      .map((signal) => signal.publishedAt?.toISOString())
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1)
    const signals = !lastPublishedAt && baselineOnFirstRun ? [] : candidateSignals

    return {
      signals,
      nextCursor: { ...cursor, ...(newest ? { lastPublishedAt: newest } : {}) }
    }
  }
}
