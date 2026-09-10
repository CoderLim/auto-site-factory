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

test("extracts Show HN product name and ignores descriptive topic words", () => {
  const good = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "Show HN: Emailclaw–Email lovers' AI agent that creates scheduled tasks",
    url: "https://github.com/emailclaw/emailclaw"
  })
  assert.ok(good.some((entity) => entity.name === "Emailclaw"))
  assert.ok(!good.some((entity) => entity.name === "Email"))

  const generic = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "An app design that combines Email and Reddit to replace Email"
  })
  assert.ok(!generic.some((entity) => entity.name === "Email" || entity.name === "Reddit"))
})

test("preserves the full versioned product instead of the mature root", () => {
  const airpods = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "AirPods 5",
    url: "https://www.apple.com/airpods-5/"
  })
  assert.ok(airpods.some((entity) => entity.name === "AirPods 5"))

  const watch = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "Apple Watch Series 12",
    url: "https://www.apple.com/apple-watch-series-12/"
  })
  assert.ok(watch.some((entity) => entity.name === "Apple Watch Series 12"))
})

test("keeps a short exact camel-case product title", () => {
  const entities = extractHeuristicEntities({
    ...base,
    sourceType: "hn" as const,
    sourceTargetId: "hn-newstories-viral",
    scope: "viral",
    title: "iPhone Duo",
    url: "https://www.apple.com/iphone-duo/"
  })
  assert.ok(entities.some((entity) => entity.name === "iPhone Duo"))
})

test("does not turn current HN news topic words into entities", () => {
  const noisyTitles = [
    "Google picks Finland for its largest single investment in Europe",
    "Secret DHS Unit Pulling People over Based on Their Financial Data",
    "'Gambling with our lives': AI researcher quits Anthropic",
    "Reddit saves your keystrokes in text boxes",
    "Automating culling – 3,478 RAW photos with 977 vision calls"
  ]

  for (const title of noisyTitles) {
    const entities = extractHeuristicEntities({
      ...base,
      sourceType: "hn" as const,
      sourceTargetId: "hn-newstories-viral",
      scope: "viral",
      title
    })
    for (const noise of ["Finland", "DHS", "Gambling", "Reddit", "RAW"]) {
      assert.ok(!entities.some((entity) => entity.name === noise), `${title} -> ${noise}`)
    }
  }
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
  assert.equal(aws?.type, undefined)
})
