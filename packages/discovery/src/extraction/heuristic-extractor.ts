import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const STOP = new Set([
  "How", "What", "When", "Where", "Why", "Who", "Anyone", "The", "This", "That",
  "New", "Best", "Guide", "Update", "Patch", "Release", "Today", "Official", "Latest"
])
const INTENT_SUFFIX = /\b(?:guide|wiki|codes?|tier list|release date|download|apk|price|review|gameplay|trailer|how to|get|fast|today|update|patch notes?)\b/gi
const GENERIC_PREFIX = /^(?:new|best|official|latest|the|this|that)\s+/i
const VIRAL_TRIGGER = /\b(?:try|tries|tried|trying|play|plays|played|playing|use|uses|used|using|meet|meets|called|named|launches|launched|launching|introduces|introduced|introducing|built|made)\s+(?:the\s+)?([A-Z][A-Za-z0-9.+#'_-]{2,50})\b/g
const NEW_ENTITY_TRIGGER = /\bnew\s+([A-Z][A-Za-z0-9.+#'_-]{2,50})\b/g

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
    .replace(/^[\s:|\-–—'“”\"]+|[\s:|\-–—'“”\"]+$/g, "")
    .trim()

  while (GENERIC_PREFIX.test(cleaned)) cleaned = cleaned.replace(GENERIC_PREFIX, "").trim()
  return cleaned
}

function isNameLikePhrase(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 5) return false
  return words.every((word) =>
    /^[A-Z][A-Za-z0-9.+#'_-]*$/.test(word)
    || /^[a-z]+[A-Z][A-Za-z0-9.+#'_-]*$/.test(word)
    || /^[A-Z]{2,}[0-9.-]*$/.test(word)
    || /^\d+(?:\.\d+)*$/.test(word)
    || /^(?:of|for|and|&)$/.test(word)
  )
}

function extractDistinctiveTokens(text: string): string[] {
  const words = text.match(/\b[A-Za-z][A-Za-z0-9.+#'_-]*\b/g) ?? []
  return words.filter((word) =>
    /[A-Za-z]+[-_.+]?[0-9]+[A-Za-z0-9.+_-]*/.test(word)
    || /^[A-Z][a-z]+[A-Z][A-Za-z0-9]*$/.test(word)
    || /^[a-z]+[A-Z][A-Za-z0-9]*$/.test(word)
    || /^[A-Za-z]+\.[A-Za-z0-9.-]+$/.test(word)
  )
}

function extractTitlePhrases(text: string): string[] {
  return [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)){0,4}\b/g)]
    .map((match) => match[0])
    .filter((phrase) => !STOP.has(phrase))
}

function extractVersionedPhrases(text: string): string[] {
  return [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9.+#'_-]*|[a-z]+[A-Z][A-Za-z0-9.+#'_-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[a-z]+[A-Z][A-Za-z0-9.+#'_-]*)){0,3}\s+(?:v?\d+(?:\.\d+){0,2})\b/g)]
    .map((match) => match[0])
    .filter(isNameLikePhrase)
}

function extractShowHnName(title: string): string[] {
  const match = title.match(/^Show\s+HN:\s*(.+)$/i)
  if (!match?.[1]) return []
  const remainder = match[1].trim()
  const first = remainder
    .split(/\s*[–—]\s*|\s+-\s+|\s*\|\s*|:\s+|\s+(?:where|that|which|for|to|with|using)\s+/i)[0]
    ?.trim()
  return first && isNameLikePhrase(first) ? [first] : []
}

function extractLeadingNamedPhrase(title: string): string[] {
  const match = title.match(/^(.{2,80}?)(?:\s*[–—]\s*|\s+-\s+|\s*\|\s*|:\s+)/)
  const first = match?.[1]?.trim()
  if (!first || /^show\s+hn$/i.test(first) || !isNameLikePhrase(first)) return []
  return [first]
}

function extractShortWholeTitle(title: string): string[] {
  const value = title.trim()
  if (!value || value.length > 80) return []
  const words = value.split(/\s+/)
  if (words.length > 4 || !isNameLikePhrase(value)) return []
  return [value]
}

function extractViralCandidates(signal: StoredSignal): string[] {
  const title = signal.title?.trim() ?? ""
  const text = `${title}\n${signal.content ?? ""}`.slice(0, 1200)
  const direct = typeof signal.metadata.directEntity === "string" && signal.metadata.directEntity.trim()
    ? [signal.metadata.directEntity.trim()]
    : []
  const productHuntTitle = String(signal.metadata.platform ?? "").toLowerCase() === "producthunt" && title
    ? [title]
    : []
  const showHn = title ? extractShowHnName(title) : []
  const leading = title ? extractLeadingNamedPhrase(title) : []
  const shortWhole = title ? extractShortWholeTitle(title) : []
  const triggered = [
    ...[...text.matchAll(VIRAL_TRIGGER)].map((match) => match[1]).filter(Boolean),
    ...[...text.matchAll(NEW_ENTITY_TRIGGER)].map((match) => match[1]).filter(Boolean)
  ] as string[]
  const versioned = extractVersionedPhrases(title)
  const distinctive = extractDistinctiveTokens(title)

  // Do not run the broad title-phrase extractor for viral scope. It is intentionally high recall
  // for game/wiki discovery, but on HN/news/YouTube it turns topic words into fake entities.
  return [...direct, ...productHuntTitle, ...showHn, ...leading, ...shortWhole, ...triggered, ...versioned, ...distinctive]
}

export function extractHeuristicEntities(signal: StoredSignal): ExtractedEntity[] {
  const text = (signal.title ?? signal.content ?? "").slice(0, 500)
  if (!text) return []

  const genericCandidates = signal.scope === "viral"
    ? extractViralCandidates(signal)
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
