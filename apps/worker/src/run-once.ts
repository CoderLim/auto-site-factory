import { Database, DiscoveryRepository, SitemapRepository } from "@factory/database"
import { getCollector, processPendingSignals } from "@factory/discovery"
import { newId, type SignalSourceType, type SourceTarget } from "@factory/shared"

const POLLING_SOURCES = new Set<SignalSourceType>(["official_api", "wiki", "reddit", "youtube", "x", "sitemap"])

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
    console.log(`[worker] ${target.sourceType}:${target.name} -> ${inserted} new signals`)
    return { inserted, failed: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repository.finishRunTarget(runId, target.id, "FAILED", 0, message)
    console.error(`[worker] collector failed ${target.sourceType}:${target.name}`, error)
    return { inserted: 0, failed: true, error: message }
  }
}

export async function runDiscoveryOnce(sourceType?: SignalSourceType): Promise<void> {
  const db = new Database()
  const repository = new DiscoveryRepository(db)
  const sitemapRepository = new SitemapRepository(db)
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
    console.log(`[worker] run=${runId} source=${sourceType ?? "all"} status=${status} signals=${signalCount} processed=${processed} newCandidates=${newCandidates}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await repository.finishRun(runId, "FAILED", 0, 0, message)
    throw error
  } finally {
    await db.close()
  }
}
