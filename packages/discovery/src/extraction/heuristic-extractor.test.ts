import assert from "node:assert/strict"
import test from "node:test"
import { extractHeuristicEntities } from "./heuristic-extractor.js"

const base = {
  id: "sig_1",
  sourceType: "reddit" as const,
  sourceTargetId: "reddit_1",
  externalId: "1",
  discoveredAt: new Date(),
  metadata: {},
  fingerprint: "x",
  scope: "wend"
}

test("extracts a named item without swallowing the sentence", () => {
  const entities = extractHeuristicEntities({
    ...base,
    title: "The new Blood Scythe is completely broken after today's Wend update"
  })
  assert.ok(entities.some((entity) => entity.name === "Blood Scythe"))
  assert.ok(!entities.some((entity) => entity.name.includes("completely broken")))
})
