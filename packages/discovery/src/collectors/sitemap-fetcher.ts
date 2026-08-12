import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { gunzipSync } from "node:zlib"
import { parseSitemapDocument } from "./sitemap-parser.js"

const execFileAsync = promisify(execFile)
const GZIP_MAGIC_0 = 0x1f
const GZIP_MAGIC_1 = 0x8b

export interface SitemapFetchOptions {
  userAgent: string
  timeoutSeconds: number
  maxSitemaps: number
  maxUrls: number
  curlFallback?: boolean
}

export function decodeSitemapBytes(bytes: Uint8Array): string {
  const data = bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1
    ? gunzipSync(bytes)
    : bytes
  return Buffer.from(data).toString("utf8")
}

async function curlGet(url: string, userAgent: string, timeoutSeconds: number): Promise<Uint8Array> {
  const { stdout } = await execFileAsync("curl", [
    "-fsSL",
    "-A",
    userAgent,
    "--max-time",
    String(timeoutSeconds),
    url
  ], { encoding: "buffer", maxBuffer: 25 * 1024 * 1024 })
  return new Uint8Array(stdout)
}

export async function fetchSitemapText(
  url: string,
  fetchImpl: typeof fetch,
  options: SitemapFetchOptions
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutSeconds * 1000)
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": options.userAgent,
        Accept: "application/xml,text/xml,text/plain,application/gzip,*/*;q=0.8"
      }
    })
    if (response.status === 403 && options.curlFallback !== false) {
      return decodeSitemapBytes(await curlGet(url, options.userAgent, options.timeoutSeconds))
    }
    if (!response.ok) throw new Error(`Sitemap ${response.status}: ${url}`)
    return decodeSitemapBytes(new Uint8Array(await response.arrayBuffer()))
  } finally {
    clearTimeout(timer)
  }
}

export async function collectSitemapUrls(
  roots: string[],
  fetchImpl: typeof fetch,
  options: SitemapFetchOptions
): Promise<string[]> {
  const queue = [...roots]
  const visited = new Set<string>()
  const seenUrls = new Set<string>()
  const urls: string[] = []

  while (queue.length > 0 && visited.size < options.maxSitemaps && urls.length < options.maxUrls) {
    const current = queue.shift()
    if (!current || visited.has(current)) continue
    visited.add(current)

    const parsed = parseSitemapDocument(await fetchSitemapText(current, fetchImpl, options))
    if (parsed.kind === "sitemapindex") {
      for (const child of parsed.locs) {
        if (!visited.has(child) && queue.length + visited.size < options.maxSitemaps) queue.push(child)
      }
      continue
    }

    for (const url of parsed.locs) {
      if (seenUrls.has(url)) continue
      seenUrls.add(url)
      urls.push(url)
      if (urls.length >= options.maxUrls) break
    }
  }

  return urls
}
