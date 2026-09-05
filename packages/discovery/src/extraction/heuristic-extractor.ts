import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const STOP = new Set([
  "How", "What", "When", "Where", "Why", "Who", "Anyone", "The", "This", "That",
  "New", "Best", "Guide", "Update", "Patch", "Release", "Today", "Official", "Latest"
])
const INTENT_SUFFIX = /\b(?:guide|wiki|codes?|tier list|release date|download|apk|price|review|gameplay|trailer|how to|get|fast|today|update|patch notes?)\b/gi
const GENERIC_PREFIX = /^(?:new|best|official|latest|the|this|that)\s+/i
const VIRAL_TRIGGER = /\b(?:try|tries|tried|trying|play|plays|played|playing|use|uses|used|using|meet|meets|called|named|launches|launched|launching|introduces|introduced|introducing|what is|who is)\s+([A-Z][A-Za-z0-9.+#'_-]{2,50})\b/g

function classify(name: string, signal: StoredSignal): EntityType {
  const lower = name.toLowerCase()

  // Viral/global discovery is intentionally conservative: surrounding title words must not
  // leak semantic types into every extracted entity.
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
  let cleaned = value
    .replace(INTENT_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, "")
    .trim()

  while (GENERIC_PREFIX.test(cleaned)) cleaned = cleaned.replace(GENERIC_PREFIX, "").trim()
  return cleaned
}

function isTitleCaseHeavy(text: string): boolean {
  const words = text.match(/\b[A-Za-z][A-Za-z0-9'_-]*\b/g) ?? []
  if (words.length < 4) return false
  const titleCase = words.filter((word) => /^[A-Z]/.test(word)).length
  return titleCase / words.length >= 0.65
}

function extractDistinctiveTokens(text: string): string[] {
  const words = text.match(/\b[A-Za-z][A-Za-z0-9.+#'_-]*\b/g) ?? []
  return words.filter((word) =>
    /^[A-Z]{2,10}(?:[0-9.-]+)?$/.test(word) ||
    /[A-Za-z]+[-_.]?[0-9]+[A-Za-z0-9.-]*/.test(word) ||
    /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*$/.test(word)
  )
}

function extractTitlePhrases(text: string): string[] {
  return [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)){0,4}\b/g)]
    .map((match) => match[0])
    .filter((phrase) => !STOP.has(phrase))
}

function extractViralCandidates(text: string): string[] {
  const quoted = [...text.matchAll(/["“']([^"”']{2,80})["”']/g)].map((match) => match[1])
  const triggered = [...text.matchAll(VIRAL_TRIGGER)].map((match) => match[1]).filter(Boolean) as string[]
  const distinctive = extractDistinctiveTokens(text)

  // Creator/video titles are often Title Case. In that case the old capitalized-phrase regex
  // turns ordinary prose into fake entities (e.g. "Buy The Fastest SSDs"). Only keep quoted,
  // trigger-derived, acronym/version/camel-case tokens. Sentence-case titles can still use the
  // broader named-phrase heuristic.
  const ordinaryNamedPhrases = isTitleCaseHeavy(text) ? [] : extractTitlePhrases(text)
  return [...quoted, ...triggered, ...distinctive, ...ordinaryNamedPhrases]
}

export function extractHeuristicEntities(signal: StoredSignal): ExtractedEntity[] {
  const text = (signal.title ?? signal.content ?? "").slice(0, 500)
  if (!text) return []

  const genericCandidates = signal.scope === "viral"
    ? extractViralCandidates(text)
    : [
        ...[...text.matchAll(/["“']([^"”']{2,80})["”']/g)].map((match) => match[1]),
        ...extractTitlePhrases(text)
      ]

  const slugPhrase = signal.sourceType === "sitemap" && typeof signal.metadata.slug === "string"
    ? signal.metadata.slug.replace(/[-_]+/g, " ")
    : undefined

  const candidates = [...genericCandidates, ...(slugPhrase ? [slugPhrase] : [])]
    .map(cleanPhrase)
    .filter((value) => value.length >= 2 && value.length <= 80)
    .filter((value) => !STOP.has(value))

  const unique = [...new Map(candidates.map((value) => [value.toLowerCase(), value])).values()]
  return unique.slice(0, 8).map((name) => ({
    name,
    type: classify(name, signal),
    confidence: signal.sourceType === "sitemap" ? 0.72 : signal.scope === "viral" ? 0.64 : 0.68,
    evidence: signal.title ?? name
  }))
}
