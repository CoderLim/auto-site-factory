import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { hnCollector } from "./hn.js"

const target: SourceTarget = {
  id: "hn-test",
  sourceType: "hn",
  name: "HN New Stories",
  scope: "viral",
  enabled: true,
  config: {
    feed: "newstories",
    maxItems: 20,
    baselineOnFirstRun: false
  }
}

const fetchImpl: typeof fetch = async (input) => {
  const url = String(input)
  if (url.endsWith("/newstories.json")) {
    return new Response(JSON.stringify([101, 100]), { status: 200 })
  }
  if (url.endsWith("/item/101.json")) {
    return new Response(JSON.stringify({
      id: 101,
      type: "story",
      by: "maker",
      time: 1788490800,
      title: "Show HN: Omoggle tracker",
      url: "https://example.test/omoggle",
      score: 3,
      descendants: 2
    }), { status: 200 })
  }
  if (url.endsWith("/item/100.json")) {
    return new Response(JSON.stringify({
      id: 100,
      type: "story",
      by: "old",
      time: 1788490000,
      title: "Old story",
      score: 1
    }), { status: 200 })
  }
  return new Response(null, { status: 404 })
}

test("HN collector emits only unseen story ids", async () => {
  const result = await hnCollector.collect(target, { seenIds: [100] }, {
    now: new Date("2026-09-04T04:00:00Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.title, "Show HN: Omoggle tracker")
  assert.equal(result.signals[0]?.sourceType, "hn")
})

test("HN collector baselines the first run by default", async () => {
  const result = await hnCollector.collect({
    ...target,
    config: { ...target.config, baselineOnFirstRun: true }
  }, undefined, {
    now: new Date("2026-09-04T04:00:00Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 0)
  assert.deepEqual(result.nextCursor?.seenIds, [101, 100])
})
