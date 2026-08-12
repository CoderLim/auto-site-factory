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

export function extractRuleEntities(signal: StoredSignal): ExtractedEntity[] {
  const direct = signal.metadata.directEntity
  if (typeof direct !== "string" || !direct.trim()) return []
  return [{
    name: direct.trim(),
    type: toEntityType(signal.metadata.entityType),
    confidence: 0.99,
    evidence: signal.title ?? direct.trim()
  }]
}
