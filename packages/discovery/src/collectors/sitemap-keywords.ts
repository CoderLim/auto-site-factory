const EXTENSIONS = [".html", ".htm", ".php", ".aspx", ".jsp", ".xml"]
const TRAILING_ID_RE = /[-_]\d{6,}$/

export function extractKeywordFromUrl(url: string): string | undefined {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(url).pathname || "")
  } catch {
    return undefined
  }

  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0) return undefined

  let slug = (segments.at(-1) ?? "").toLowerCase()
  for (const extension of EXTENSIONS) {
    if (slug.endsWith(extension)) {
      slug = slug.slice(0, -extension.length)
      break
    }
  }

  slug = slug.replace(TRAILING_ID_RE, "")
  const phrase = slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()
  if (!phrase || phrase.length < 2 || /^\d+$/.test(phrase)) return undefined
  return phrase
}
