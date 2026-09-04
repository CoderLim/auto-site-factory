import { Database, DiscoveryRepository, KeywordRepository, SitemapRepository } from "@factory/database"
import { generateKeywordCandidate, getCollector, processPendingSignals } from "@factory/discovery"
import { newId, type SignalSourceType, type SourceTarget } from "@factory/shared"

const POLLING_SOURCES = new Set<SignalSourceType>([
  "official_api",
  "wiki",
  "wiki_gg",
  "reddit",
  "youtube",
  "twitch",
  "hn",
  "rss",
  "x",
  "sitemap"
])

function numberFromCursor(cursor: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = cursor?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

async function collectTarget(
  runId: string,
  target: SourceTarget,
  repository: DiscoveryRepository,
  sitemapRepository: SitemapRepository
): Promise<{ inserted: number; failed: boolean; error?: string }> {
  const collector = getCollector(target.sourceType)
  if (!collector) return { inserted: 0, failed: false }

  await repository.startRunTarget(runId, target.id)
  await repository.markCursorAttempt(target.id)
  try {
    const cursor = await repository.getCursor(target.id)
    const result = await collector.collect(target, cursor, {
      now: new Date(),
      fetch,
      sitemapStore: target.sourceType === "sitemap" ? sitemapRepository : undefined
    })
    const inserted = await repository.insertSignals(result.signals)
    if (result.afterPersist) await result.afterPersist()
    if (result.nextCursor) await repository.saveCursor(target.id, result.nextCursor)
    await repository.finishRunTarget(runId, target.id, "SUCCESS", inserted)

    if (target.sourceType === "sitemap") {
      const fetchedUrls = numberFromCursor(result.nextCursor, "discoveredUrlCount")
      const filteredUrls = numberFromCursor(result.nextCursor, "urlCount")
      const sitemapCount = numberFromCursor(result.nextCursor, "sitemapCount")
      const pending = numberFromCursor(result.nextCursor, "pendingNewUrls")
      console.log(
        `[worker] sitemap:${target.name} -> ${inserted} new signals` +
        ` · ${filteredUrls ?? "?"}/${fetchedUrls ?? "?"} URLs after filter` +
        ` · ${sitemapCount ?? "?"} sitemap(s)` +
        ` · ${pending ?? 0} pending`
      )
    } else {
      console.log(`[worker] ${target.sourceType}:${target.name} -> ${inserted} new signals`)
    }
    return { inserted, failed: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repository.finishRunTarget(runId, target.id, "FAILED", 0, message)
    console.error(`[worker] collector failed ${target.sourceType}:${target.name}`, error)
    return { inserted: 0, failed: true, error: message }
  }
}

async function generateMissingKeywords(repository: KeywordRepository): Promise<{ generated: number; lowSearchability: number }> {
  let generated = 0
  let lowSearchability = 0

  while (true) {
    const seeds = await repository.listMissingSeeds(1000)
    if (seeds.length === 0) break

    const items = seeds.flatMap((seed) => {
      const item = generateKeywordCandidate(seed)
      return item ? [item] : []
    })

    await repository.saveGenerated(items)
    generated += items.length
    lowSearchability += items.filter((item) => item.status === "low_searchability").length

    if (seeds.length < 1000) break
    if (items.length === 0) break
  }

  return { generated, lowSearchability }
}

export async function runDiscoveryOnce(sourceType?: SignalSourceType): Promise<void> {
  const db = new Database()
  const repository = new DiscoveryRepository(db)
  const sitemapRepository = new SitemapRepository(db)
  const keywordRepository = new KeywordRepository(db)
  const runId = newId("run")
  await repository.createRun(runId)

  try {
    const targets = (await repository.listEnabledTargets()).filter((target) =>
      POLLING_SOURCES.has(target.sourceType) && (!sourceType || target.sourceType === sourceType)
    )
    const results = await Promise.all(
      targets.map((target) => collectTarget(runId, target, repository, sitemapRepository))
    )
    const signalCount = results.reduce((sum, item) => sum + item.inserted, 0)
    const failures = results.filter((item) => item.failed)

    let processed = 0
    let newCandidates = 0
    while (true) {
      const batch = await processPendingSignals(repository, 500)
      processed += batch.processed
      newCandidates += batch.newCandidates
      if (batch.processed < 500) break
    }

    const keywordResult = await generateMissingKeywords(keywordRepository)

    const status = failures.length === 0
      ? "SUCCESS"
      : failures.length < Math.max(1, targets.length)
        ? "PARTIAL_SUCCESS"
        : "FAILED"

    await repository.finishRun(
      runId,
      status,
      signalCount,
      newCandidates,
      failures.map((item) => item.error).filter(Boolean).join(" | ") || undefined
    )
    console.log(
      `[worker] run=${runId} source=${sourceType ?? "all"} status=${status}` +
      ` signals=${signalCount} processed=${processed} newCandidates=${newCandidates}` +
      ` keywordCandidates=${keywordResult.generated} lowSearchability=${keywordResult.lowSearchability}`
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repository.finishRun(runId, "FAILED", 0, 0, message)
    throw error
  } finally {
    await db.close()
  }
}
