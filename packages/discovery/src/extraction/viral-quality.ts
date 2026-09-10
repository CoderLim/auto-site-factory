import type { ExtractedEntity, StoredSignal } from "@factory/shared"

const HARD_NOISE = new Set([
  "a", "an", "and", "are", "as", "at", "be", "best", "but", "by", "for", "from", "get", "guide",
  "how", "i", "if", "in", "is", "it", "latest", "new", "of", "official", "on", "or", "release",
  "that", "the", "this", "today", "update", "what", "when", "where", "who", "why", "with", "you",
  "your"
])

const GENERIC_TOPICS = new Set([
  "ai", "agent", "agents", "api", "app", "apps", "browser", "chat", "cloud", "code", "coding",
  "crypto", "data", "database", "design", "email", "finance", "game", "games", "gaming", "gambling",
  "hardware", "health", "image", "images", "internet", "laptop", "manager", "model", "models", "music",
  "news", "option", "photo", "photos", "privacy", "raw", "research", "search", "security", "server",
  "service", "software", "social", "startup", "startups", "system", "tech", "technology", "tool", "tools",
  "tutorial", "video", "web", "website"
])

const SOURCE_BOILERPLATE = new Set([
  "ask hn", "show hn", "how hn", "hacker news", "product hunt", "techmeme", "macrumors", "the daily",
  "source", "sources"
])

const MATURE_ROOT_ENTITIES = new Set([
  "airpods", "amazon", "anthropic", "apache tika", "apple", "applecare", "aws", "chatgpt", "claude",
  "discord", "facebook", "freebsd", "gemini", "github", "gmail", "google", "instagram", "iphone", "lean4",
  "linux", "meta", "microsoft", "nasa", "nvidia", "openai", "reddit", "roblox", "smash bros",
  "super smash bros", "steam", "tiktok", "twitter", "windows", "youtube"
])

const NON_ENTITY_HOSTS = new Set([
  "bbc.com", "bloomberg.com", "engadget.com", "forbes.com", "medium.com", "news.ycombinator.com",
  "nytimes.com", "osnews.com", "reddit.com", "reuters.com", "substack.com", "techcrunch.com", "techmeme.com",
  "theverge.com", "twitter.com", "wikipedia.org", "www.wikipedia.org", "x.com", "youtube.com"
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
  "announce", "announces", "announced", "announcing", "called", "named", "debut", "debuts", "debuted",
  "introduce", "introduces", "introduced", "introducing", "launch", "launches", "launched", "launching",
  "meet", "meets", "release", "releases", "released", "releasing", "ship", "ships", "shipped",
  "unveil", "unveils", "unveiled", "unveiling", "built", "made"
]
const USAGE_VERBS = ["try", "tries", "tried", "trying", "play", "plays", "played", "playing", "use", "uses", "used", "using"]
const SENTENCE_WORDS = new Set([
  "adopts", "are", "becomes", "building", "can", "could", "creating", "getting", "has", "have", "is", "kept",
  "lost", "making", "outsmarting", "running", "saves", "set", "should", "using", "was", "were", "will",
  "working", "would", "writing"
])

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

function wordCount(name: string): number {
  return normalizedPhrase(name).split(/\s+/).filter(Boolean).length
}

function isPlainAcronym(name: string): boolean {
  return /^[A-Z]{2,8}$/.test(name)
}

function isDottedAcronym(name: string): boolean {
  return /^(?:[A-Za-z]\.){1,}[A-Za-z]?\.?$/.test(name)
}

function isVersionOnly(name: string): boolean {
  return /^v?\d+(?:\.\d+){1,3}(?:\s+(?:alpha|beta|rc\d*))?$/i.test(name)
}

function isReleaseLabelOnly(name: string): boolean {
  return /^(?:release|version)\s+v?\d+(?:\.\d+){1,3}(?:\s+(?:alpha|beta|rc\d*))?$/i.test(name)
}

function hasPossessiveFragment(name: string): boolean {
  return /(?:'s|’s)(?:\s|$)/i.test(name)
}

function looksLikeDomain(name: string): boolean {
  return /^[A-Za-z0-9-]+\.[A-Za-z]{2,}$/.test(name)
}

function isSpecificVariant(name: string): boolean {
  return /[A-Za-z]\d|\d[A-Za-z]/.test(name)
    || /\bv?\d+(?:\.\d+){0,3}\b/i.test(name)
    || looksLikeDomain(name)
    || /[a-z][A-Z]/.test(name)
    || /[+#_]/.test(name)
}

function isTrustedDirectEntity(name: string, signal: StoredSignal): boolean {
  const direct = metadataString(signal, "directEntity")
  if (direct && normalizeToken(direct) === normalizeToken(name)) return true
  return sourcePlatform(signal) === "producthunt"
    && Boolean(signal.title)
    && normalizeToken(signal.title ?? "") === normalizeToken(name)
}

function hostIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "")
  if (NON_ENTITY_HOSTS.has(host)) return true
  return [...NON_ENTITY_HOSTS].some((blocked) => host.endsWith(`.${blocked}`))
}

function candidateMatchesDedicatedUrl(name: string, signal: StoredSignal): boolean {
  const normalized = normalizeToken(name)
  if (normalized.length < 4) return false

  const urls = [signal.url, metadataString(signal, "outboundUrl"), metadataString(signal, "url")]
    .filter((value): value is string => Boolean(value))
  const domain = metadataString(signal, "domain")
  if (domain) urls.push(`https://${domain}`)

  for (const value of urls) {
    try {
      const parsed = new URL(value)
      const host = parsed.hostname.replace(/^www\./, "")
      if (hostIsBlocked(host)) continue

      const labels = host.split(".").slice(0, -1)
      if (labels.some((part) => normalizeToken(part) === normalized)) return true

      const pathParts = parsed.pathname.split("/").filter(Boolean)
      if (pathParts.some((part) => normalizeToken(part) === normalized)) return true
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return false
}

function hasMoreSpecificContinuation(name: string, signal: StoredSignal): boolean {
  const title = signal.title ?? ""
  if (!title) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`\\b${escaped}\\s+(?:v?\\d+(?:\\.\\d+)*|Pro|Max|Ultra|Mini|Air|Plus|SE|Series\\s+\\d+|One\\b|Family\\b)`, "i").test(title)
}

function hasExplicitNamingContext(name: string, signal: StoredSignal): boolean {
  const text = `${signal.title ?? ""}\n${signal.content ?? ""}`.slice(0, 1800)
  const escaped = escapeRegExp(name)
  const verbs = STRONG_NAMING_VERBS.join("|")
  return new RegExp(`\\b(?:${verbs})\\s+(?:the\\s+)?["'“]?${escaped}["'”]?(?=$|[,;:|–—-]|\\s+(?:for|to|with|that|which|where|as)\\b)`, "i").test(text)
}

function hasBrandVersionLaunchContext(name: string, signal: StoredSignal): boolean {
  const title = signal.title?.trim() ?? ""
  const match = title.match(/^([A-Z][A-Za-z0-9.+#'_-]*(?:\s+[A-Z][A-Za-z0-9.+#'_-]*){0,2})\s+(?:launch(?:es|ed|ing)?|introduce(?:s|d|ing)?|release(?:s|d|ing)?|unveil(?:s|ed|ing)?|announce(?:s|d|ing)?)\s+(v?\d+(?:\.\d+){0,3})(?:\s+(flash|pro|max|ultra|mini|air|plus|se|turbo|lite|preview|alpha|beta))?\b/i)
  if (!match?.[1] || !match?.[2]) return false
  const expected = `${match[1]} ${match[2]}${match[3] ? ` ${match[3]}` : ""}`
  return normalizeToken(expected) === normalizeToken(name)
}

function hasUsageContext(name: string, signal: StoredSignal): boolean {
  if (name.length < 4 || /\s/.test(name)) return false
  const text = `${signal.title ?? ""}\n${signal.content ?? ""}`.slice(0, 1000)
  const escaped = escapeRegExp(name)
  return new RegExp(`\\b(?:${USAGE_VERBS.join("|")})\\s+${escaped}\\b`, "i").test(text)
    || new RegExp(`\\bnew\\s+${escaped}\\b`, "i").test(text)
}

function isHnLaunchEntity(name: string, signal: StoredSignal): boolean {
  const title = signal.title?.trim() ?? ""
  if (!/^(?:show|how)\s+hn:/i.test(title)) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`^(?:show|how)\\s+hn:\\s*${escaped}(?=$|\\s*[|:–—>(])`, "i").test(title)
}

function hasNamedTitlePrefix(name: string, signal: StoredSignal): boolean {
  if (wordCount(name) > 3) return false
  const title = signal.title?.trim() ?? ""
  if (!title) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`^${escaped}(?:\\s*[|:]\\s*|\\s+[–—-]\\s+|\\s+>\\s+|\\s+(?:launch|launched|beta|app|game|tool)\\b)`, "i").test(title)
}

function hasSpecificTitleStart(name: string, signal: StoredSignal): boolean {
  if (!isSpecificVariant(name)) return false
  const title = signal.title?.trim() ?? ""
  if (!title) return false
  const escaped = escapeRegExp(name)
  return new RegExp(`^${escaped}(?=$|\\s|[|:–—>(])`, "i").test(title)
}

function looksLikeSentenceFragment(name: string): boolean {
  const words = normalizedPhrase(name).split(/\s+/).filter(Boolean)
  if (words.length >= 5) return true
  return words.some((word) => SENTENCE_WORDS.has(word))
}

function isBlockedName(name: string): boolean {
  const phrase = normalizedPhrase(name)
  const single = !phrase.includes(" ")
  if (!phrase) return true
  if (HARD_NOISE.has(phrase) || SOURCE_BOILERPLATE.has(phrase) || GEOGRAPHIES.has(phrase)) return true
  if (isVersionOnly(name) || isReleaseLabelOnly(name) || isDottedAcronym(name) || hasPossessiveFragment(name)) return true
  if (single && GENERIC_TOPICS.has(phrase)) return true
  if (MATURE_ROOT_ENTITIES.has(phrase)) return true
  if (single && isPlainAcronym(name) && !isSpecificVariant(name)) return true
  return false
}

export function isHighQualityViralEntity(entity: ExtractedEntity, signal: StoredSignal): boolean {
  if (signal.scope !== "viral") return true

  const name = entity.name.trim()
  if (!name || isBlockedName(name)) return false
  if (looksLikeSentenceFragment(name)) return false
  if (hasMoreSpecificContinuation(name, signal)) return false

  if (isTrustedDirectEntity(name, signal)) return true
  if (isHnLaunchEntity(name, signal)) return true
  if (hasExplicitNamingContext(name, signal)) return true
  if (hasBrandVersionLaunchContext(name, signal)) return true
  if (hasUsageContext(name, signal)) return true
  if (candidateMatchesDedicatedUrl(name, signal)) return true
  if (hasNamedTitlePrefix(name, signal)) return true
  if (hasSpecificTitleStart(name, signal)) return true

  if (["PRODUCT", "TOOL", "GAME", "AI_MODEL"].includes(entity.type) && entity.confidence >= 0.8) return true
  return false
}

export function filterViralEntities(entities: ExtractedEntity[], signal: StoredSignal): ExtractedEntity[] {
  if (signal.scope !== "viral") return entities
  return entities.filter((entity) => isHighQualityViralEntity(entity, signal))
}
