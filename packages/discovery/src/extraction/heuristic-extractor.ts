import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const STOP = new Set([
  "How", "What", "When", "Where", "Why", "Who", "Anyone", "The", "This", "That",
  "New", "Best", "Guide", "Update", "Patch", "Release", "Today", "Official", "Latest"
])
const INTENT_SUFFIX = /\b(?:guide|wiki|codes?|tier list|release date|download|apk|price|review|gameplay|trailer|how to|get|fast|today|update|patch notes?)\b/gi

function classify(name: string, signal: StoredSignal): EntityType {
  const lower = name.toLowerCase()

  // Global viral discovery is intentionally conservative: the surrounding HN/YouTube/RSS
  // title must not leak words such as "world" or "map" into every extracted entity.
  if (/\b(model|llm|gpt|gemini|claude|qwen|llama)\b/.test(lower)) return "AI_MODEL"
  if (/\b(ai|tool|generator|editor|assistant)\b/.test(lower)) return "TOOL"
  if (signal.scope === "viral") return "OTHER"

  if (/\b(sword|katana|scythe|gun|weapon|armor|item|blade|potion)\b/.test(lower)) return "ITEM"
  if (/\b(map|island|city|zone|world)\b/.test(lower)) return "MAP"
  if (/\b(mode|gamemode)\b/.test(lower)) return "MODE"
  if (/\b(event|festival|season)\b/.test(lower)) return "EVENT"
  return "OTHER"
}

function cleanPhrase(value: string): string {
  return value
    .replace(INTENT_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, "")
    .trim()
}

export function extractHeuristicEntities(signal: StoredSignal): ExtractedEntity[] {
  const text = (signal.title ?? signal.content ?? "").slice(0, 500)
  if (!text) return []

  const quoted = [...text.matchAll(/["“']([^"”']{2,80})["”']/g)].map((match) => match[1])
  const titlePhrases = [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)){0,4}\b/g)]
    .map((match) => match[0])
    .filter((phrase) => !STOP.has(phrase))

  const slugPhrase = signal.sourceType === "sitemap" && typeof signal.metadata.slug === "string"
    ? signal.metadata.slug.replace(/[-_]+/g, " ")
    : undefined

  const candidates = [...quoted, ...titlePhrases, ...(slugPhrase ? [slugPhrase] : [])]
    .map(cleanPhrase)
    .filter((value) => value.length >= 2 && value.length <= 80)
    .filter((value) => !STOP.has(value))

  const unique = [...new Map(candidates.map((value) => [value.toLowerCase(), value])).values()]
  return unique.slice(0, 8).map((name) => ({
    name,
    type: classify(name, signal),
    confidence: signal.sourceType === "sitemap" ? 0.72 : 0.68,
    evidence: signal.title ?? name
  }))
}
