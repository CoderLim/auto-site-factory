import type { ExtractedEntity, StoredSignal } from "@factory/shared"
import { extractHeuristicEntities } from "./heuristic-extractor.js"
import { extractLlmEntities } from "./llm-extractor.js"
import { extractRuleEntities } from "./rule-extractor.js"

export async function extractEntities(signal: StoredSignal): Promise<ExtractedEntity[]> {
  const rule = extractRuleEntities(signal)
  if (rule.length > 0) return rule

  const llm = await extractLlmEntities(signal)
  if (llm.length > 0) return llm

  return extractHeuristicEntities(signal)
}

export * from "./prefilter.js"
export * from "./heuristic-extractor.js"
export * from "./rule-extractor.js"
