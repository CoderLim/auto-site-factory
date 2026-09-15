import { Database } from "@factory/database"
import { itchCommentsUrl, parseItchCommentsCount, parseItchGameMetrics } from "@factory/discovery"

type ItchSignalRow = {
  id: string
  url: string
}

const USER_AGENT = "auto-site-factory/0.1 itch-radar (+https://github.com/CoderLim/auto-site-factory)"

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(raw)) return fallback
  return Math.min(max, Math.max(min, Math.floor(raw)))
}

async function fetchText(url: string, timeoutSeconds = 20): Promise<string | undefined> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000)
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,*/*;q=0.8"
      }
    })
    if (!response.ok) return undefined
    return await response.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

async function sampleSignal(db: Database, row: ItchSignalRow): Promise<boolean> {
  const gameHtml = await fetchText(row.url)
  if (!gameHtml) return false

  const game = parseItchGameMetrics(gameHtml)
  const commentsHtml = await fetchText(itchCommentsUrl(row.url))
  const comments = commentsHtml ? parseItchCommentsCount(commentsHtml) : undefined

  if (game.ratings == null && comments == null) return false

  const observedAt = new Date()
  const metadata = {
    platform: "itch",
    ratingAverage: game.ratingAverage,
    ratings: game.ratings,
    comments
  }

  await db.query(
    `INSERT INTO signal_metric_snapshots (
       raw_signal_id, observed_at, score, comments, metadata
     ) VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (raw_signal_id, observed_at) DO NOTHING`,
    [row.id, observedAt, game.ratings ?? null, comments ?? null, JSON.stringify(metadata)]
  )

  await db.query(
    `UPDATE raw_signals
     SET metadata = metadata || $2::jsonb
     WHERE id = $1`,
    [row.id, JSON.stringify({ itchLatest: metadata, itchLastCheckedAt: observedAt.toISOString() })]
  )

  return true
}

async function runPool<T>(items: T[], concurrency: number, task: (item: T) => Promise<boolean>): Promise<number> {
  let cursor = 0
  let sampled = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++
      const item = items[index]
      if (item == null) return
      if (await task(item)) sampled += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return sampled
}

export async function revalidateRecentItchSignals(): Promise<void> {
  const lookbackHours = envInt("ITCH_REVALIDATE_HOURS", 7 * 24, 6, 30 * 24)
  const limit = envInt("ITCH_REVALIDATE_LIMIT", 100, 1, 500)
  const concurrency = envInt("ITCH_REVALIDATE_CONCURRENCY", 4, 1, 8)
  const db = new Database()

  try {
    const result = await db.query<ItchSignalRow>(
      `SELECT rs.id, rs.url
       FROM raw_signals rs
       WHERE rs.metadata->>'platform' = 'itch'
         AND rs.url IS NOT NULL
         AND rs.discovered_at >= NOW() - make_interval(hours => $1::int)
       ORDER BY rs.discovered_at DESC
       LIMIT $2`,
      [lookbackHours, limit]
    )

    const sampled = await runPool(result.rows, concurrency, (row) => sampleSignal(db, row))
    console.log(`[itch-radar] sampled=${sampled}/${result.rows.length} lookbackHours=${lookbackHours}`)
  } finally {
    await db.close()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  revalidateRecentItchSignals().catch((error) => {
    console.error("[itch-radar] revalidation failed", error)
    process.exitCode = 1
  })
}
