import assert from "node:assert/strict"
import test from "node:test"
import { generateKeywordCandidate, humanizeEntityName } from "./generate.js"

function seed(name: string, entityType = "TOOL", scope = "ai-tools") {
  return {
    entityId: `ent-${name}`,
    name,
    entityType,
    scope,
    firstSeenAt: "2026-08-19T00:00:00.000Z",
    lastSeenAt: "2026-08-19T00:00:00.000Z"
  }
}

test("humanizes Hugging Face slugs", () => {
  assert.equal(humanizeEntityName("deepseek-v2-lite_mxfp8"), "deepseek v2 lite mxfp8")
})

test("keeps useful multi-token model names pending validation", () => {
  const result = generateKeywordCandidate(seed("deepseek-v2-lite_mxfp8", "AI_MODEL", "ai"))
  assert.equal(result?.keyword, "deepseek v2 lite mxfp8")
  assert.equal(result?.status, "pending_validation")
  assert.ok((result?.searchabilityScore ?? 0) >= 55)
})

test("downgrades generic single-word spaces", () => {
  const result = generateKeywordCandidate(seed("calculator"))
  assert.equal(result?.status, "low_searchability")
})

test("downgrades date-stamped experiment names", () => {
  const result = generateKeywordCandidate(seed("Github_20260817", "AI_MODEL", "ai"))
  assert.equal(result?.status, "low_searchability")
})

test("adds game scope context for generic wiki entities", () => {
  const result = generateKeywordCandidate(seed("Dragon", "ITEM", "blox-fruits"))
  assert.equal(result?.keyword, "blox fruits Dragon")
  assert.equal(result?.generationKind, "scope_context")
  assert.equal(result?.status, "pending_validation")
})

test("never prefixes operational viral scope to keywords", () => {
  const result = generateKeywordCandidate(seed("Machine Evolution", "MAP", "viral"))
  assert.equal(result?.keyword, "Machine Evolution")
  assert.equal(result?.generationKind, "entity_name")
  assert.ok(!(result?.generationReasons ?? []).includes("scope_context_added"))
})

test("does not reward stale domain entity types inside viral scope", () => {
  const result = generateKeywordCandidate(seed("AWS", "MAP", "viral"))
  assert.equal(result?.keyword, "AWS")
  assert.ok(!(result?.generationReasons ?? []).includes("named_entity_type"))
  assert.equal(result?.status, "low_searchability")
})

test("downgrades prose-like viral phrases from creator titles", () => {
  const noisy = [
    "Save Yourself In",
    "Buy The Fastest SSDs",
    "Grow Cars",
    "Ultimate Analysis And Breakdown",
    "Off The Rails",
    "His Greatest Episode",
    "Moderate Health Issues",
    "Moo Deng Dreams",
    "AWS-bench"
  ]

  for (const name of noisy) {
    const result = generateKeywordCandidate(seed(name, "OTHER", "viral"))
    assert.equal(result?.status, "low_searchability", name)
  }
})
