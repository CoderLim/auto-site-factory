import type { EntityType, ExtractedEntity, StoredSignal } from "@factory/shared"

const STOP = new Set([
  "How", "What", "When", "Where", "Why", "Who", "Anyone", "The", "This", "That",
  "New", "Best", "Guide", "Update", "Patch", "Release", "Today", "Official", "Latest"
])
const INTENT_SUFFIX = /\b(?:guide|wiki|codes?|tier list|release date|download|apk|price|review|gameplay|trailer|how to|get|fast|today|update|patch notes?)\b/gi
const GENERIC_PREFIX = /^(?:new|best|official|latest|the|this|that)\s+/i
const VERSIONED_NOISE_PREFIX = /^(?:release|version|getting|using|making|building|running|writing|creating)\s+/i
const ACTION_VERBS = new Set([
  "announce", "announces", "announced", "announcing",
  "build", "builds", "built", "building",
  "call", "calls", "called", "calling",
  "debut", "debuts", "debuted", "debuting",
  "introduce", "introduces", "introduced", "introducing",
  "launch", "launches", "launched", "launching",
  "make", "makes", "made", "making",
  "meet", "meets", "met",
  "open-source", "open-sources", "open-sourced",
  "release", "releases", "released", "releasing",
  "ship", "ships", "shipped", "shipping",
  "unveil", "unveils", "unveiled", "unveiling"
])
const USAGE_VERBS = new Set([
  "play", "plays", "played", "playing",
  "try", "tries", "tried", "trying",
  "use", "uses", "used", "using"
])
const CLAUSE_BREAKERS = new Set([
  "and", "as", "because", "but", "for", "from", "that", "to", "using", "where", "which", "with"
])
const RELEASE_QUALIFIERS = /\s+(?:alpha|beta|preview|rc\d*)$/i

function classify(name: string, signal: StoredSignal): EntityType {
  const lower = name.toLowerCase()
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
    .replace(/^[\s:|\-–—>'“”\"]+|[\s:|\-–—>'“”\"]+$/g, "")
    .replace(RELEASE_QUALIFIERS, "")
    .trim()
  while (GENERIC_PREFIX.test(cleaned)) cleaned = cleaned.replace(GENERIC_PREFIX, "").trim()
  return cleaned
}

function isNameToken(token: string): boolean {
  return /^[A-Z][A-Za-z0-9.+#'_-]*$/.test(token)
    || /^[a-z]+[A-Z][A-Za-z0-9.+#'_-]*$/.test(token)
    || /^(?:v?\d+(?:\.\d+){0,3}|\d+)$/i.test(token)
    || /^(?:of|for|and|&)$/.test(token)
}

function isNameLikePhrase(value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  return words.every(isNameToken)
}

function takeNamedRun(value: string, maxTokens = 6): string | undefined {
  const trimmed = value
    .replace(/^[\s'"“”]+/, "")
    .split(/[,;!?]|\s*[–—]\s*|\s+-\s+|\s*\|\s*|\s*\(|\s*\[/)[0]
    ?.trim()
  if (!trimmed) return undefined

  const out: string[] = []
  for (const rawToken of trimmed.split(/\s+/)) {
    const token = rawToken.replace(/[)'"”]+$/g, "")
    if (!token) break
    if (CLAUSE_BREAKERS.has(token.toLowerCase()) && out.length > 0) break
    if (!isNameToken(token)) break
    out.push(token)
    if (out.length >= maxTokens) break
  }
  const phrase = cleanPhrase(out.join(" "))
  return phrase && isNameLikePhrase(phrase) ? phrase : undefined
}

function extractHnLaunchName(title: string): string[] {
  const match = title.match(/^(?:Show|How)\s+HN:\s*(.+)$/i)
  if (!match?.[1]) return []
  const first = takeNamedRun(match[1], 6)
  return first ? [first] : []
}

function extractLeadingNamedPhrase(title: string): string[] {
  const match = title.match(/^(.{2,90}?)(?:\s*[–—]\s*|\s+-\s+|\s*\|\s*|:\s+)/)
  const first = cleanPhrase(match?.[1]?.trim() ?? "")
  if (!first || /^(?:show|ask|how)\s+hn$/i.test(first) || !isNameLikePhrase(first)) return []
  return [first]
}

function extractShortWholeTitle(title: string): string[] {
  const value = cleanPhrase(title)
  if (!value || value.length > 80) return []
  const words = value.split(/\s+/)
  if (words.length > 4 || !isNameLikePhrase(value)) return []
  return [value]
}

function extractVersionedPhrases(title: string): string[] {
  const matches = [...title.matchAll(/\b((?:[A-Z][A-Za-z0-9.+#'_-]*|[a-z]+[A-Z][A-Za-z0-9.+#'_-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[a-z]+[A-Z][A-Za-z0-9.+#'_-]*)){0,3}\s+(?:v?\d+(?:\.\d+){0,3}|\d+)(?:\s+(?:Pro|Max|Ultra|Mini|Air|Plus|SE|Series\s+\d+))?)\b/g)]
    .map((match) => cleanPhrase(match[1] ?? ""))
    .filter(Boolean)
    .filter((value) => !VERSIONED_NOISE_PREFIX.test(value))
  return matches.filter(isNameLikePhrase)
}

function extractBrandVersionLaunch(title: string): string[] {
  const match = title.match(/^([A-Z][A-Za-z0-9.+#'_-]*(?:\s+[A-Z][A-Za-z0-9.+#'_-]*){0,2})\s+(?:launch(?:es|ed|ing)?|introduce(?:s|d|ing)?|release(?:s|d|ing)?|unveil(?:s|ed|ing)?|announce(?:s|d|ing)?)\s+(v?\d+(?:\.\d+){0,3})(?:\s+(flash|pro|max|ultra|mini|air|plus|se|turbo|lite|preview|alpha|beta))?\b/i)
  if (!match?.[1] || !match?.[2]) return []
  const variant = match[3] ? `${match[3][0]?.toUpperCase() ?? ""}${match[3].slice(1).toLowerCase()}` : ""
  return [`${match[1]} ${match[2]}${variant ? ` ${variant}` : ""}`]
}

function extractVerbNamedPhrases(text: string): string[] {
  const words = [...text.matchAll(/\b([A-Za-z][A-Za-z-]*)\b/g)]
  const results: string[] = []

  for (let index = 0; index < words.length; index += 1) {
    const match = words[index]
    const verb = match?.[1]?.toLowerCase()
    if (!verb || (!ACTION_VERBS.has(verb) && !USAGE_VERBS.has(verb) && verb !== "new")) continue

    const start = (match.index ?? 0) + (match[0]?.length ?? 0)
    const remainder = text.slice(start).replace(/^\s+(?:the\s+)?/i, "")
    const named = takeNamedRun(remainder, ACTION_VERBS.has(verb) ? 6 : 2)
    if (!named) continue
    results.push(named)
  }
  return results
}

function extractQuotedAnnouncement(text: string): string[] {
  return [...text.matchAll(/\b(?:announce(?:s|d|ing)?|introduce(?:s|d|ing)?|launch(?:es|ed|ing)?|unveil(?:s|ed|ing)?|release(?:s|d|ing)?)\s+["'“]([^"'”]{2,80})["'”]/gi)]
    .map((match) => cleanPhrase(match[1] ?? ""))
    .filter((value) => Boolean(value) && isNameLikePhrase(value))
}

function extractViralCandidates(signal: StoredSignal): string[] {
  const title = signal.title?.trim() ?? ""
  const text = `${title}\n${signal.content ?? ""}`.slice(0, 1600)
  const direct = typeof signal.metadata.directEntity === "string" && signal.metadata.directEntity.trim()
    ? [signal.metadata.directEntity.trim()]
    : []
  const productHuntTitle = String(signal.metadata.platform ?? "").toLowerCase() === "producthunt" && title
    ? [title]
    : []

  return [
    ...direct,
    ...productHuntTitle,
    ...(title ? extractHnLaunchName(title) : []),
    ...(title ? extractLeadingNamedPhrase(title) : []),
    ...(title ? extractShortWholeTitle(title) : []),
    ...(title ? extractVersionedPhrases(title) : []),
    ...(title ? extractBrandVersionLaunch(title) : []),
    ...extractVerbNamedPhrases(text),
    ...extractQuotedAnnouncement(text)
  ]
}

function extractTitlePhrases(text: string): string[] {
  return [...text.matchAll(/\b(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)(?:\s+(?:[A-Z][A-Za-z0-9.+#'_-]*|[A-Z]{2,}[0-9.-]*)){0,4}\b/g)]
    .map((match) => match[0])
    .filter((phrase) => !STOP.has(phrase))
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
