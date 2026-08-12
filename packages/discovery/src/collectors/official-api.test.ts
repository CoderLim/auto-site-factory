import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { officialApiCollector } from "./official-api.js"

const target: SourceTarget = {
  id: "official-test",
  sourceType: "official_api",
  name: "Official Test",
  scope: "test",
  enabled: true,
  config: {
    url: "https://example.test/releases",
    publishedAtField: "created_at"
  }
}

const fetchImpl: typeof fetch = async () => new Response(JSON.stringify([
  { id: "1", name: "Brand New Thing", created_at: "2026-08-12T07:00:00.000Z" }
]), { status: 200, headers: { "content-type": "application/json" } })

test("official API establishes a baseline on first run by default", async () => {
  const result = await officialApiCollector.collect(target, undefined, {
    now: new Date("2026-08-12T08:00:00.000Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 0)
  assert.equal(result.nextCursor?.lastPublishedAt, "2026-08-12T07:00:00.000Z")
})

test("official API can explicitly backfill on first run", async () => {
  const result = await officialApiCollector.collect({
    ...target,
    config: { ...target.config, baselineOnFirstRun: false }
  }, undefined, {
    now: new Date("2026-08-12T08:00:00.000Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.title, "Brand New Thing")
})
