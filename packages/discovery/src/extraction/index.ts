import type { ExtractedEntity, StoredSignal } from "@factory/shared"
import { extractHeuristicEntities } from "./heuristic-extractor.js"
import { extractLlmEntities } from "./llm-extractor.js"
import { extractRuleEntities } from "./rule-extractor.js"
import { filterViralEntities } from "./viral-quality.js"

const NON_IDENTITY_HOSTS = new Set([
  "bbc.com", "bloomberg.com", "engadget.com", "forbes.com", "medium.com", "news.ycombinator.com",
  "nytimes.com", "osnews.com", "reddit.com", "reuters.com", "substack.com", "techcrunch.com", "techmeme.com",
  "theverge.com", "twitter.com", "wikipedia.org", "x.com", "youtube.com"
])

function normalizeIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function metadataString(signal: StoredSignal, key: string): string | undefined {
  const value = signal.metadata[key]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function sourcePlatform(signal: StoredSignal): string {
  return metadataString(signal, "platform")?.toLowerCase() ?? signal.sourceType
}

function hostIsNonIdentity(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "")
  if (NON_IDENTITY_HOSTS.has(host)) return true
  return [...NON_IDENTITY_HOSTS].some((blocked) => host.endsWith(`.${blocked}`))
}

function matchesDedicatedIdentityUrl(name: string, signal: StoredSignal): boolean {
  const normalized = normalizeIdentity(name)
  if (normalized.length < 4) return false

  const urls = [signal.url, metadataString(signal, "outboundUrl"), metadataString(signal, "url")]
    .filter((value): value is string => Boolean(value))
  const domain = metadataString(signal, "domain")
  if (domain) urls.push(`https://${domain}`)

  for (const value of urls) {
    try {
      const parsed = new URL(value)
      const host = parsed.hostname.replace(/^www\./, "")
      if (hostIsNonIdentity(host)) continue

      const labels = host.split(".").slice(0, -1)
      if (labels.some((part) => normalizeIdentity(part) === normalized)) return true

      const pathParts = parsed.pathname.split("/").filter(Boolean)
      if (pathParts.some((part) => normalizeIdentity(part) === normalized)) return true
    } catch {
      // Malformed URLs are not identity evidence.
    }
  }

  return false
}

function hasStrongSingleWordIdentityEvidence(name: string, signal: StoredSignal): boolean {
  const normalized = normalizeIdentity(name)
  const direct = metadataString(signal, "directEntity")
  if (direct && normalizeIdentity(direct) === normalized) return true

  const title = signal.title?.trim() ?? ""
  if (sourcePlatform(signal) === "producthunt" && title && normalizeIdentity(title) === normalized) return true

  if (title) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    if (new RegExp(`^(?:show|how)\\s+hn:\\s*${escaped}(?=$|\\s*[|:–—>(])`, "i").test(title)) return true
  }

  return matchesDedicatedIdentityUrl(name, signal)
}

export function filterAmbiguousSingleWordEntities(
  entities: ExtractedEntity[],
  signal: StoredSignal
): ExtractedEntity[] {
  if (signal.scope !== "viral") return entities

  return entities.filter((entity) => {
    if (entity.type !== "OTHER") return true
    const name = entity.name.trim()
    if (!name || /\s/.test(name)) return true
    if (/[A-Za-z]\d|\d[A-Za-z]/.test(name) || /[a-z][A-Z]/.test(name) || /[+#_-]/.test(name)) return true
    return hasStrongSingleWordIdentityEvidence(name, signal)
  })
}

function qualityFilter(entities: ExtractedEntity[], signal: StoredSignal): ExtractedEntity[] {
  return filterAmbiguousSingleWordEntities(filterViralEntities(entities, signal), signal)
}

export async function extractEntities(signal: StoredSignal): Promise<ExtractedEntity[]> {
  const rule = extractRuleEntities(signal)
  // directEntity is explicitly configured by a source adapter (for example itch game titles).
  // Treat it as authoritative so sentence-like legitimate names are not rejected by generic headline heuristics.
  if (rule.length > 0) return rule

  const llm = await extractLlmEntities(signal)
  if (llm.length > 0) return qualityFilter(llm, signal)

  return qualityFilter(extractHeuristicEntities(signal), signal)
}

export * from "./prefilter.js"
export * from "./heuristic-extractor.js"
export * from "./rule-extractor.js"
export * from "./viral-quality.js"
