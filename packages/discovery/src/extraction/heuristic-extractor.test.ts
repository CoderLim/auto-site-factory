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

test("extracts an Omoggle-style novel product name from a creator title without an LLM", () => {
  const entities = extractHeuristicEntities({
    ...base,
    sourceType: "youtube" as const,
    sourceTargetId: "youtube-xqc-viral",
    scope: "viral",
    title: "xQc tries Omoggle for the first time"
  })
  assert.ok(entities.some((entity) => entity.name === "Omoggle"))
})

test("ignores a generic New prefix but keeps the novel entity", () => {
  const entities = extractHeuristicEntities({
    ...base,
    sourceType: "youtube" as const,
    sourceTargetId: "youtube-xqc-viral",
    scope: "viral",
    title: "New Omoggle update is everywhere"
  })
  assert.ok(entities.some((entity) => entity.name === "Omoggle"))
  assert.ok(!entities.some((entity) => entity.name === "New"))
})

test("does not turn title-case YouTube prose into fake entities", () => {
  const noisyTitles = [
    "Save Yourself In The Biggest Survival Challenge",
    "Buy The Fastest SSDs Before Prices Go Up",
    "Ultimate Analysis And Breakdown Of The Episode",
    "Moderate Health Issues After The Stream"
  ]

  for (const title of noisyTitles) {
    const entities = extractHeuristicEntities({
      ...base,
      sourceType: "youtube" as const,
      sourceTargetId: "youtube-viral",
      scope: "viral",
      title
    })
    assert.ok(!entities.some((entity) => entity.name === title))
    assert.ok(!entities.some((entity) => /^(Save Yourself In|Buy The Fastest SSDs|Ultimate Analysis And Breakdown|Moderate Health Issues)$/.test(entity.name)))
  }
})

test("does not classify every viral entity from unrelated title words", () => {
  const entities = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "AWS benchmark reveals an Invisible World of machine evolution"
  })
  const aws = entities.find((entity) => entity.name === "AWS")
  assert.equal(aws?.type, "OTHER")
})
