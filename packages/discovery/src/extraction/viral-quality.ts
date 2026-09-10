import type { ExtractedEntity, StoredSignal } from "@factory/shared"

const HARD_NOISE = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "for", "from", "get", "guide",
  "how", "i", "if", "in", "is", "it", "latest", "new", "of", "official", "on", "or", "release",
  "that", "the", "this", "today", "update", "what", "when", "where", "who", "why", "with", "you",
  "your"
])

// Generic topics can trend, but they are not the new named entities this radar is meant to discover.
const GENERIC_TOPICS = new Set([
  "ai", "agent", "agents", "api", "app", "apps", "browser", "chat", "cloud", "code", "coding",
  "crypto", "data", "database", "design", "email", "finance", "game", "games", "gaming", "gambling",
  "hardware", "health", "image", "images", "internet", "laptop", "model", "models", "music", "news",
  "photo", "photos", "privacy", "raw", "research", "search", "security", "server", "software", "social",
  "startup", "startups", "tech", "technology", "tool", "tools", "video", "web", "website"
])

// Mature root entities are useful context, but seeing the root name again is not a new-entity opportunity.
// A specific variant such as "AirPods 5" or "ChatGPT Images 2.5" is not blocked by this set.
const MATURE_ROOT_ENTITIES = new Set([
  "airpods", "amazon", "anthropic", "apple", "aws", "chatgpt", "claude", "discord", "facebook", "gemini",
  "github", "gmail", "google", "instagram", "iphone", "linux", "meta", "microsoft", "nasa", "nvidia",
  "openai", "reddit", "roblox", "steam", "tiktok", "twitter", "windows", "youtube"
])

const GEOGRAPHIES = new Set([
  "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia", "austria",
  "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium", "belize", "benin",
  "bhutan", "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria", "burkina faso", "burundi",
  "cambodia", "cameroon", "canada", "chad", "chile", "china", "colombia", "croatia", "cuba", "cyprus",
  "czechia", "denmark", "dominica", "ecuador", "egypt", "eritrea", "estonia", "ethiopia", "fiji",
  "finland", "france", "gabon", "gambia", "georgia", "germany", "ghana", "greece", "grenada", "guatemala",
  "guinea", "guyana", "haiti", "honduras", "hungary", "iceland", "india", "indonesia", "iran", "iraq",
  "ireland", "israel", "italy", "jamaica", "japan", "jordan", "kazakhstan", "kenya", "kuwait", "kyrgyzstan",
  "laos", "latvia", "lebanon", "lesotho", "liberia", "libya", "liechtenstein", "lithuania", "luxembourg",
  "madagascar", "malawi", "malaysia", "maldives", "mali", "malta", "mauritania", "mauritius", "mexico",
  "moldova", "monaco", "mongolia", "montenegro", "morocco", "mozambique", "myanmar", "namibia", "nauru",
  "nepal", "netherlands", "new zealand", "nicaragua", "niger", "nigeria", "north korea", "north macedonia",
  "norway", "oman", "pakistan", "palau", "panama", "paraguay", "peru", "philippines", "poland", "portugal",
  "qatar", "romania", "russia", "rwanda", "samoa", "san marino", "saudi arabia", "senegal", "serbia",
  "seychelles", "sierra leone", "singapore", "slovakia", "slovenia", "somalia", "south africa", "south korea",
  "spain", "sri lanka", "sudan", "suriname", "sweden", "switzerland", "syria", "taiwan", "tajikistan",
  "tanzania", "thailand", "togo", "tonga", "tunisia", "turkey", "turkmenistan", "uganda", "ukraine",
  "united arab emirates", "united kingdom", "united states", "uruguay", "uzbekistan", "vanuatu", "venezuela",
  "vietnam", "yemen", "zambia", "zimbabwe"
])

const STRONG_NAMING_VERBS = [
  "called", "named", "launch", "launches", "launched", "launching", "introduces", "introduced",
  "introducing", "meet", "meets", "built", "made"
]

const USAGE_VERBS = ["try", "tries", "tried", "trying", "play", "plays", "played", "playing", "use", "uses", "used", "using"]

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function normalizedPhrase(value: string): string {
  return value.toLowerCase().replace(/[._-]+/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function metadataString(signal: StoredSignal, key: string): string | undefined {
  const value = signal.metadata[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sourcePlatform(signal: StoredSignal): string {
  return metadataString(signal, "platform")?.toLowerCase() ?? signal.sourceType
}

function isSpecificVariant(name: string): boolean {
  if (/\d/.test(name)) return true
  if (/[.+#_]/.test(name)) return true
  if (/[a-z][A-Z]/.test(name)) return true
  return false
}

function isPlainAcronym(name: string): boolean {
  return /^[A-Z]{2,8}$/.test(name)
}

function isTrustedDirectEntity(name: string, signal: StoredSignal): boolean {
  const direct = metadataString(signal, "directEntity")
  if (direct && normalizeToken(direct) === normalizeToken(name)) return true

  // Product Hunt's RSS title is the launched item name. Treat it as an explicit entity declaration.
  return sourcePlatform(signal) === "producthunt"
    && Boolean(signal.title)
    && normalizeToken(signal.title ?? "") === normalizeToken(name)
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
      const parsed = new URL(value)
      const hostLabels = parsed.hostname.replace(/^www\./, "").split(".").slice(0, -1)
      const pathParts = parsed.pathname.split("/").filter(Boolean)
      const candidates = [...hostLabels, ...pathParts]
      if (candidates.some((part) => normalizeToken(part) === normalized)) return true
    } catch {
      // Ignore malformed source URLs; they are not strong evidence.
    }
  }

  return false
}

function isShadowedByMoreSpecificVariant(name: string, signal: StoredSignal): boolean {
  const title = signal.title ?? ""
  if (!title) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`\\b${escaped}\\s+(?:v?\\d+(?:\\.\\d+)*|pro\\s+\\d+|series\\s+\\d+)\\b`, "i").test(title)
}

function hasExplicitNamingContext(name: string, signal: StoredSignal): boolean {
  const text = `${signal.title ?? ""}\n${signal.content ?? ""}`.slice(0, 1600)
  const escaped = escapeRegExp(name)
  return new RegExp(`\\b(?:${STRONG_NAMING_VERBS.join("|")})\\s+(?:the\\s+)?${escaped}(?=$|[\\s:|–—-])`, "i").test(text)
}

function hasUsageContext(name: string, signal: StoredSignal): boolean {
  if (name.length < 5 || /\s/.test(name)) return false
  const text = `${signal.title ?? ""}\n${signal.content ?? ""}`.slice(0, 1000)
  const escaped = escapeRegExp(name)
  return new RegExp(`\\b(?:${USAGE_VERBS.join("|")})\\s+${escaped}\\b`, "i").test(text)
    || new RegExp(`\\bnew\\s+${escaped}\\b`, "i").test(text)
}

function hasLaunchTitleContext(name: string, signal: StoredSignal): boolean {
  const title = signal.title?.trim() ?? ""
  if (!title) return false
  const escaped = escapeRegExp(name)

  if (new RegExp(`^show\\s+hn:\\s*${escaped}(?=$|\\s*[|:–—-])`, "i").test(title)) return true
  if (new RegExp(`^${escaped}(?=$|\\s*[|:–—-])`, "i").test(title)) return true
  if (new RegExp(`^${escaped}\\s+(?:launch|launched|beta|app|game|tool)\\b`, "i").test(title)) return true
  return false
}

function hasBrandLikeShape(name: string): boolean {
  if (/\d/.test(name)) return true
  if (/[.+#_]/.test(name)) return true
  if (/[a-z][A-Z]/.test(name)) return true
  return false
}

function isBlockedStandaloneName(name: string): boolean {
  const phrase = normalizedPhrase(name)
  const single = !phrase.includes(" ")
  if (HARD_NOISE.has(phrase)) return true
  if (GEOGRAPHIES.has(phrase)) return true
  if (single && GENERIC_TOPICS.has(phrase)) return true
  if (single && MATURE_ROOT_ENTITIES.has(phrase) && !isSpecificVariant(name)) return true
  if (single && isPlainAcronym(name) && !isSpecificVariant(name)) return true
  return false
}

export function isHighQualityViralEntity(entity: ExtractedEntity, signal: StoredSignal): boolean {
  if (signal.scope !== "viral") return true

  const name = entity.name.trim()
  if (!name) return false
  if (isBlockedStandaloneName(name)) return false
  if (isShadowedByMoreSpecificVariant(name, signal)) return false

  const direct = isTrustedDirectEntity(name, signal)
  if (direct) return true

  const phrase = normalizedPhrase(name)
  const single = !phrase.includes(" ")
  if (single && (GENERIC_TOPICS.has(phrase) || GEOGRAPHIES.has(phrase) || MATURE_ROOT_ENTITIES.has(phrase))) return false

  if (candidateMatchesUrl(name, signal)) return true
  if (hasExplicitNamingContext(name, signal)) return true
  if (hasLaunchTitleContext(name, signal)) return true
  if (hasUsageContext(name, signal)) return true

  // Distinctive product-like spellings are useful even before a second platform confirms them.
  // Ordinary Title Case phrases do not get this shortcut.
  if (hasBrandLikeShape(name) && !isPlainAcronym(name)) return true

  // A semantic extractor can still rescue a plain brand, but only at high confidence.
  if (entity.type === "PRODUCT" || entity.type === "TOOL" || entity.type === "GAME" || entity.type === "AI_MODEL") {
    return entity.confidence >= 0.8
  }

  return false
}

export function filterViralEntities(entities: ExtractedEntity[], signal: StoredSignal): ExtractedEntity[] {
  if (signal.scope !== "viral") return entities
  return entities.filter((entity) => isHighQualityViralEntity(entity, signal))
}
