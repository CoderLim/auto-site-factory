export type ItchGameMetrics = {
  ratings?: number
  ratingAverage?: number
  comments?: number
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
}

function htmlText(value: string): string {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCount(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/,/g, ""))
  return Number.isFinite(parsed) ? parsed : undefined
}

export function parseItchGameMetrics(html: string): ItchGameMetrics {
  const text = htmlText(html)
  const rating = text.match(/Rated\s+([0-9]+(?:\.[0-9]+)?)\s+out of\s+5\s+stars\s*\(?\s*([\d,]+)\s+total ratings?\s*\)?/i)

  return {
    ratingAverage: rating?.[1] ? Number(rating[1]) : undefined,
    ratings: parseCount(rating?.[2])
  }
}

export function parseItchCommentsCount(html: string): number | undefined {
  const text = htmlText(html)
  const paged = text.match(/Viewing most recent comments\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i)
    ?? text.match(/Comments\s+\d+\s+to\s+\d+\s+of\s+([\d,]+)/i)
  const pagedCount = parseCount(paged?.[1])
  if (pagedCount != null) return pagedCount

  // Small threads do not always render a total. Counting post containers gives
  // a useful exact value while the thread still fits on one page.
  const postCount = (html.match(/class=["'][^"']*\bcommunity_post\b[^"']*["']/gi) ?? []).length
  return postCount > 0 ? postCount : undefined
}

export function itchCommentsUrl(gameUrl: string): string {
  const url = new URL(gameUrl)
  url.search = ""
  url.hash = ""
  url.pathname = `${url.pathname.replace(/\/$/, "")}/comments`
  return url.toString()
}
