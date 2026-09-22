import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { tiktokCollector } from "./tiktok.js"

const target: SourceTarget = {
  id: "tiktok-trending-us-viral",
  sourceType: "tiktok",
  name: "TikTok Explore Trending (US)",
  scope: "viral",
  enabled: true,
  config: {
    tokenEnv: "APIFY_TOKEN",
    actorId: "xtracto~tiktok-trending-scraper",
    countryCode: "US",
    maxItems: 20,
    historyLimit: 100,
    baselineOnFirstRun: false,
    snapshotExisting: true
  }
}

test("TikTok collector maps Explore metrics and resnapshots seen videos", async () => {
  const previousToken = process.env.APIFY_TOKEN
  process.env.APIFY_TOKEN = "test-token"

  let requestedUrl = ""
  let requestedBody: Record<string, unknown> = {}

  const mockFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requestedUrl = String(input)
    requestedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
    return new Response(JSON.stringify([
      {
        id: "7637369500161084692",
        desc: "AI action figure trend #aiactionfigure",
        createTime: 1789980000,
        author: { uniqueId: "trendcreator", nickname: "Trend Creator", verified: false },
        stats: {
          playCount: 250000,
          diggCount: 18000,
          commentCount: 900,
          shareCount: 3200,
          collectCount: 4100
        },
        music: { id: "music-1", title: "Original sound", authorName: "trendcreator" },
        challenges: [{ id: "tag-1", title: "aiactionfigure" }],
        _rank: 1,
        _source: "S1-explore-api",
        _scrapedAt: "2026-09-22T01:00:00Z"
      }
    ]), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  }

  try {
    const first = await tiktokCollector.collect(target, undefined, {
      now: new Date("2026-09-22T01:00:00Z"),
      fetch: mockFetch as typeof fetch
    })

    assert.equal(first.signals.length, 1)
    const signal = first.signals[0]
    assert.ok(signal)
    assert.equal(signal.sourceType, "tiktok")
    assert.equal(signal.externalId, "7637369500161084692")
    assert.equal(signal.author, "trendcreator")
    assert.equal(signal.metadata.platform, "tiktok")
    assert.equal(signal.metadata.views, 250000)
    assert.equal(signal.metadata.likes, 18000)
    assert.equal(signal.metadata.comments, 900)
    assert.equal(signal.metadata.shares, 3200)
    assert.deepEqual(signal.metadata.hashtags, ["aiactionfigure"])
    assert.equal(signal.metadata.snapshotExisting, false)
    assert.match(requestedUrl, /xtracto~tiktok-trending-scraper/)
    assert.equal(requestedBody.content_type, "video")
    assert.equal(requestedBody.country_code, "US")
    assert.equal(requestedBody.limit, 20)

    const second = await tiktokCollector.collect(target, first.nextCursor, {
      now: new Date("2026-09-22T03:00:00Z"),
      fetch: mockFetch as typeof fetch
    })
    assert.equal(second.signals.length, 1)
    assert.equal(second.signals[0]?.metadata.snapshotExisting, true)
  } finally {
    if (previousToken == null) delete process.env.APIFY_TOKEN
    else process.env.APIFY_TOKEN = previousToken
  }
})
