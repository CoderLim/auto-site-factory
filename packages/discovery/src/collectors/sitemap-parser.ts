export type SitemapKind = "urlset" | "sitemapindex"

export interface ParsedSitemap {
  kind: SitemapKind
  locs: string[]
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
}

function directLoc(block: string): string | undefined {
  const match = block.match(/<loc\b[^>]*>([\s\S]*?)<\/loc>/i)
  const value = match?.[1]?.trim()
  return value ? decodeXmlEntities(value) : undefined
}

export function parseTextSitemap(text: string): ParsedSitemap {
  const locs = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith("#"))
    .filter((line) => line.startsWith("http://") || line.startsWith("https://"))

  if (locs.length === 0) throw new Error("empty or unsupported text sitemap")
  return { kind: "urlset", locs }
}

export function parseXmlSitemap(xml: string): ParsedSitemap {
  const isIndex = /<sitemapindex\b/i.test(xml)
  const isUrlSet = /<urlset\b/i.test(xml)
  if (!isIndex && !isUrlSet) throw new Error("unsupported sitemap root element")

  const locs: string[] = []
  const blockPattern = isIndex
    ? /<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi
    : /<url\b[^>]*>([\s\S]*?)<\/url>/gi

  for (const match of xml.matchAll(blockPattern)) {
    const loc = directLoc(match[1] ?? "")
    if (loc) locs.push(loc)
  }

  return { kind: isIndex ? "sitemapindex" : "urlset", locs }
}

export function parseSitemapDocument(text: string): ParsedSitemap {
  return text.trimStart().startsWith("<") ? parseXmlSitemap(text) : parseTextSitemap(text)
}
