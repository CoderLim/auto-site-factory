import type { ExtractedEntity, StoredSignal } from "@factory/shared"

const HARD_NOISE = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "for", "from", "get", "guide",
  "how", "i", "if", "in", "is", "it", "latest", "new", "of", "official", "on", "or", "release",
  "that", "the", "this", "today", "update", "what", "when", "where", "who", "why", "with", "you",
  "your"
])

const NAMING_VERBS = [
  "called", "named", "launch", "launches", "launched", "launching", "introduces", "introduced",
  "introducing", "meet", "meets", "try", "tries", "tried", "trying", "use", "uses", "used", "using",
  "play", "plays", "played", "playing", "built", "made"
]

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function metadataString(signal: StoredSignal, key: string): string | undefined {
  const value = signal.metadata[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function candidateMatchesUrl(name: string, signal: StoredSignal): boolean {
  const normalized = normalizeToken(name)
  if (normalized.length < 3) return false

  const urls = [
    signal.url,
    metadataString(signal, "outboundUrl"),
    metadataString(signal, "url")
  ].filter((value): value is string => Boolean(value))

  const domain = metadataString(signal, "domain")
  if (domain) urls.push(`https://${domain}`)

  for (const value of urls) {
    try {
      const hostname = new URL(value).hostname.replace(/^www\./, "")
      const labels = hostname.split(".")
      if (labels.some((label) => normalizeToken(label) === normalized)) return true
      if (normalizeToken(hostname).includes(normalized) && normalized.length >= 5) return true
    } catch {
      // Ignore malformed source URLs; they are not strong evidence.
    }
  }

  return false
}

function hasExplicitNamingContext(name: string, signal: StoredSignal): boolean {
  const text = `${signal.title ?? ""}\n${signal.content ?? ""}`.slice(0, 1200)
  const escaped = escapeRegExp(name)

  if (new RegExp(`["“']${escaped}["”']`, "i").test(text)) return true
  if (new RegExp(`\\b(?:${NAMING_VERBS.join("|")})\\s+${escaped}\\b`, "i").test(text)) return true
  if (new RegExp(`\\bnew\\s+${escaped}\\b`, "i").test(text)) return true

  const title = signal.title?.trim() ?? ""
  if (!title) return false
  if (new RegExp(`^(?:show\\s+hn:\\s*)?${escaped}(?:\\s*[:|–—-]|$)`, "i").test(title)) return true

  return false
}

function hasBrandLikeShape(name: string): boolean {
  if (/\d/.test(name)) return true
  if (/[.+#_-]/.test(name)) return true
  if (/[a-z][A-Z]/.test(name)) return true
  return false
}

function isSingleToken(name: string): boolean {
  return !/\s/.test(name.trim())
}

function isDirectEntity(name: string, signal: StoredSignal): boolean {
  const direct = metadataString(signal, "directEntity")
  return Boolean(direct && direct.localeCompare(name, undefined, { sensitivity: "accent" }) === 0)
}

export function isHighQualityViralEntity(entity: ExtractedEntity, signal: StoredSignal): boolean {
  if (signal.scope !== "viral") return true

  const name = entity.name.trim()
  if (!name) return false

  const normalized = name.toLowerCase()
  if (HARD_NOISE.has(normalized)) return false

  if (isDirectEntity(name, signal)) return true
  if (!isSingleToken(name)) return true

  // Single-word entities are where most Viral Radar noise comes from. Keep them only when
  // the source itself provides strong naming/brand evidence.
  if (candidateMatchesUrl(name, signal)) return true
  if (hasExplicitNamingContext(name, signal)) return true
  if (hasBrandLikeShape(name)) return true

  // LLM/rule extraction can occasionally provide a confident semantic type even for a plain
  // one-word brand. Preserve those, while generic OTHER acronyms/common nouns are filtered.
  if (entity.type === "PRODUCT" || entity.type === "TOOL" || entity.type === "GAME" || entity.type === "AI_MODEL") {
    return entity.confidence >= 0.8
  }

  return false
}

export function filterViralEntities(entities: ExtractedEntity[], signal: StoredSignal): ExtractedEntity[] {
  if (signal.scope !== "viral") return entities
  return entities.filter((entity) => isHighQualityViralEntity(entity, signal))
}
