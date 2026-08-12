import type { ExtractedEntity, StoredSignal } from "@factory/shared"
import { extractEntities } from "../extraction/index.js"
import { shouldProcessSignal } from "../extraction/prefilter.js"
import { normalizeEntityName } from "../normalization/normalize.js"

export interface DiscoveryStore {
  getPendingSignals(limit?: number): Promise<StoredSignal[]>
  registerEntityMention(
    signal: StoredSignal,
    entity: ExtractedEntity,
    normalizedName: string
  ): Promise<{ entityId: string; candidateCreated: boolean }>
  markSignalProcessed(signalId: string): Promise<void>
}

export async function processPendingSignals(
  store: DiscoveryStore,
  limit = 500
): Promise<{ processed: number; mentions: number; newCandidates: number }> {
  const signals = await store.getPendingSignals(limit)
  let processed = 0
  let mentions = 0
  let newCandidates = 0

  for (const signal of signals) {
    try {
      if (!shouldProcessSignal(signal)) {
        await store.markSignalProcessed(signal.id)
        processed += 1
        continue
      }

      const entities = await extractEntities(signal)
      const seen = new Set<string>()
      for (const entity of entities) {
        const normalizedName = normalizeEntityName(entity.name)
        if (!normalizedName || normalizedName.length < 2) continue
        const key = `${entity.type}:${normalizedName}`
        if (seen.has(key)) continue
        seen.add(key)
        const result = await store.registerEntityMention(signal, entity, normalizedName)
        mentions += 1
        if (result.candidateCreated) newCandidates += 1
      }

      await store.markSignalProcessed(signal.id)
      processed += 1
    } catch (error) {
      console.error("[discovery] failed to process raw signal", signal.id, error)
    }
  }

  return { processed, mentions, newCandidates }
}
