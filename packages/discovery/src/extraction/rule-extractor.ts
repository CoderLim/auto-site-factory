import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const ENTITY_TYPES = new Set<EntityType>([
  "GAME",
  "TOOL",
  "AI_MODEL",
  "PRODUCT",
  "CHARACTER",
  "ITEM",
  "FEATURE",
  "MAP",
  "EVENT",
  "MODE",
  "OTHER"
])

function toEntityType(value: unknown): EntityType {
  return typeof value === "string" && ENTITY_TYPES.has(value as EntityType)
    ? value as EntityType
    : "OTHER"
}

function extractTikTokDiscoveryEntity(signal: StoredSignal): ExtractedEntity[] {
  if (signal.sourceType !== "tiktok") return []
  if (String(signal.metadata.platform ?? "").toLowerCase() !== "tiktok") return []

  const contentType = String(signal.metadata.contentType ?? "").toLowerCase()
  if (!["hashtag", "music", "creator", "topic"].includes(contentType)) return []

  const title = signal.title?.trim()
  if (!title) return []
  const name = contentType === "hashtag" ? title.replace(/^#+/, "").trim() : title
  if (!name) return []

  return [{
    name,
    type: "OTHER",
    confidence: 0.99,
    evidence: signal.title ?? name
  }]
}

export function extractRuleEntities(signal: StoredSignal): ExtractedEntity[] {
  const direct = signal.metadata.directEntity
  if (typeof direct === "string" && direct.trim()) {
    return [{
      name: direct.trim(),
      type: toEntityType(signal.metadata.entityType),
      confidence: 0.99,
      evidence: signal.title ?? direct.trim()
    }]
  }

  return extractTikTokDiscoveryEntity(signal)
}
