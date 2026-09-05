export type KeywordSeed = {
  entityId: string
  name: string
  entityType: string
  scope: string
  firstSeenAt: string
  lastSeenAt: string
}

export type GeneratedKeywordCandidate = {
  entityId: string
  keyword: string
  normalizedKeyword: string
  status: "pending_validation" | "low_searchability"
  searchabilityScore: number
  generationKind: "entity_name" | "scope_context"
  generationReasons: string[]
  firstSeenAt: string
  lastSeenAt: string
}

const GENERIC_SINGLE_WORDS = new Set([
  "app", "calculator", "demo", "example", "github", "model",
  "sample", "space", "test", "tool", "untitled"
])

// These scopes describe where/how an entity was discovered, not semantic keyword context.
const OPERATIONAL_SCOPES = new Set(["viral"])
const GENERIC_SCOPES = new Set(["ai", "ai-tools", "tools", "web-games", "steam-games", ...OPERATIONAL_SCOPES])
const CONTEXTUAL_ENTITY_TYPES = new Set(["ITEM", "EVENT", "MAP", "MODE", "OTHER"])
const VIRAL_FUNCTION_WORDS = new Set([
  "a", "an", "and", "as", "at", "for", "from", "his", "her", "in", "into", "my",
  "of", "off", "on", "or", "our", "the", "their", "this", "to", "with", "your", "yourself"
])
const VIRAL_GENERIC_START = /^(?:save|buy|grow|watch|learn|make|build|how|why|what|when|where|who|ultimate|moderate|best|new|official|latest)\b/i
const VIRAL_GENERIC_END = /\b(?:analysis|breakdown|episode|issues?|dreams?|story|video|stream|challenge|reaction|review|guide|news|update|bench|benchmark)\b$/i

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

export function humanizeEntityName(value: string): string {
  return safeDecode(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeKeyword(value: string): string {
  const unicode = value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
  const ascii = unicode.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
  return ascii || unicode
}

function hasScopePrefix(keyword: string, scope: string): boolean {
  const a = normalizeKeyword(keyword)
  const b = normalizeKeyword(humanizeEntityName(scope))
  return Boolean(b) && (a === b || a.startsWith(`${b} `) || a.endsWith(` ${b}`))
}

function scoreKeyword(keyword: string, rawName: string, entityType: string, scope: string) {
  const reasons: string[] = []
  const normalized = normalizeKeyword(keyword)
  const tokens = normalized.split(" ").filter(Boolean)
  let score = 60

  if (tokens.length >= 2 && tokens.length <= 6) { score += 15; reasons.push("natural_token_count") }
  if (!OPERATIONAL_SCOPES.has(scope) && ["AI_MODEL", "TOOL", "GAME", "ITEM", "EVENT", "MAP", "MODE"].includes(entityType)) {
    score += 5; reasons.push("named_entity_type")
  }
  if (tokens.length === 1) { score -= 10; reasons.push("single_token") }
  if (tokens.length === 1 && GENERIC_SINGLE_WORDS.has(tokens[0] ?? "")) {
    score -= 50; reasons.push("generic_single_word")
  }
  if (/^(test|demo|sample|tmp|temp|untitled)( |$)/i.test(normalized) && tokens.length <= 2) {
    score -= 35; reasons.push("test_like_name")
  }
  if (/20\d{6}/.test(rawName)) { score -= 45; reasons.push("date_suffix") }
  if (normalized.length < 4) { score -= 30; reasons.push("too_short") }
  if (normalized.length > 80 || tokens.length > 10) { score -= 25; reasons.push("too_long") }
  if (/v?\d+\.\d+/.test(normalized)) { score += 5; reasons.push("version_marker") }

  if (scope === "viral") {
    if (tokens.length >= 3) { score -= 20; reasons.push("viral_phrase_too_broad") }
    if (tokens.some((token) => VIRAL_FUNCTION_WORDS.has(token))) {
      score -= 25; reasons.push("viral_prose_function_words")
    }
    if (VIRAL_GENERIC_START.test(normalized)) {
      score -= 25; reasons.push("viral_generic_lead")
    }
    if (VIRAL_GENERIC_END.test(normalized)) {
      score -= 25; reasons.push("viral_generic_tail")
    }
  }

  return { score: Math.max(0, Math.min(100, score)), reasons }
}

export function generateKeywordCandidate(seed: KeywordSeed): GeneratedKeywordCandidate | undefined {
  const base = humanizeEntityName(seed.name)
  if (!base) return undefined
  const addScope = CONTEXTUAL_ENTITY_TYPES.has(seed.entityType) && !GENERIC_SCOPES.has(seed.scope) && !hasScopePrefix(base, seed.scope)
  const keyword = addScope ? `${humanizeEntityName(seed.scope)} ${base}`.replace(/\s+/g, " ").trim() : base
  const normalizedKeyword = normalizeKeyword(keyword)
  if (!normalizedKeyword) return undefined

  const scored = scoreKeyword(keyword, seed.name, seed.entityType, seed.scope)
  if (addScope) { scored.score = Math.min(100, scored.score + 10); scored.reasons.push("scope_context_added") }

  return {
    entityId: seed.entityId,
    keyword,
    normalizedKeyword,
    status: scored.score >= 55 ? "pending_validation" : "low_searchability",
    searchabilityScore: scored.score,
    generationKind: addScope ? "scope_context" : "entity_name",
    generationReasons: scored.reasons,
    firstSeenAt: seed.firstSeenAt,
    lastSeenAt: seed.lastSeenAt
  }
}
