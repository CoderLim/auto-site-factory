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

test("official API can filter Digg-style events and retain author/platform metadata", async () => {
  const diggTarget: SourceTarget = {
    id: "digg-test",
    sourceType: "official_api",
    name: "Digg Trending",
    scope: "viral",
    enabled: true,
    config: {
      url: "https://di.gg/api/trending/status",
      itemsPath: "events",
      idField: "id",
      nameFields: ["label"],
      publishedAtField: "at",
      authorField: "username",
      urlField: "permalink",
      includeField: "type",
      includeValues: ["cluster_detected", "fast_climb"],
      directEntity: true,
      entityType: "OTHER",
      platform: "digg",
      sourceRole: "discovery",
      baselineOnFirstRun: false
    }
  }

  const diggFetch: typeof fetch = async () => new Response(JSON.stringify({
    computedAt: "2026-09-09T15:00:00.000Z",
    events: [
      {
        id: "evt-1",
        type: "fast_climb",
        label: "Hop.Earth",
        username: "thirdparty",
        permalink: "https://x.com/thirdparty/status/1",
        delta: 12,
        at: "2026-09-09T14:55:00.000Z"
      },
      {
        id: "evt-2",
        type: "embedding_progress",
        label: "pipeline event",
        at: "2026-09-09T14:56:00.000Z"
      }
    ]
  }), { status: 200, headers: { "content-type": "application/json" } })

  const result = await officialApiCollector.collect(diggTarget, undefined, {
    now: new Date("2026-09-09T15:00:00.000Z"),
    fetch: diggFetch
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.title, "Hop.Earth")
  assert.equal(result.signals[0]?.author, "thirdparty")
  assert.equal(result.signals[0]?.url, "https://x.com/thirdparty/status/1")
  assert.equal(result.signals[0]?.metadata.platform, "digg")
  assert.equal(result.signals[0]?.metadata.sourceRole, "discovery")
  assert.equal(result.signals[0]?.metadata.directEntity, "Hop.Earth")
})
