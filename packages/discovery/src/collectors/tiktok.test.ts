import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { tiktokCollector } from "./tiktok.js"

const target: SourceTarget = {
  id: "tiktok-trending-us-viral",
  sourceType: "tiktok",
  name: "TikTok Trends (US)",
  scope: "viral",
  enabled: true,
  config: {
    tokenEnv: "APIFY_TOKEN",
    actorId: "xtracto~tiktok-trending-scraper",
    countryCode: "US",
    maxItems: 20,
    historyLimit: 100,
    baselineOnFirstRun: false,
    snapshotExisting: true,
    discoverListUrl: "https://us.tiktok.com/node/share/discover/list",
    discoverMirrorUrl: "https://raw.githubusercontent.com/antiops/tiktok-trending-data/main/discover-list-us.json"
  }
}

test("TikTok collector supports Apify video metrics and tokenless discover topics", async () => {
  const previousToken = process.env.APIFY_TOKEN

  try {
    process.env.APIFY_TOKEN = "test-token"
    let requestedUrl = ""
    let requestedBody: Record<string, unknown> = {}

    const apifyFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
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

    const first = await tiktokCollector.collect(target, undefined, {
      now: new Date("2026-09-22T01:00:00Z"),
      fetch: apifyFetch as typeof fetch
    })

    assert.equal(first.signals.length, 1)
    const signal = first.signals[0]
    assert.ok(signal)
    assert.equal(signal.sourceType, "tiktok")
    assert.equal(signal.externalId, "7637369500161084692")
    assert.equal(signal.author, "trendcreator")
    assert.equal(signal.metadata.platform, "tiktok")
    assert.equal(signal.metadata.provider, "apify")
    assert.equal(signal.metadata.contentType, "video")
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
      fetch: apifyFetch as typeof fetch
    })
    assert.equal(second.signals.length, 1)
    assert.equal(second.signals[0]?.metadata.snapshotExisting, true)

    delete process.env.APIFY_TOKEN
    let discoverRequests = 0
    const discoverFetch = async (input: string | URL | Request): Promise<Response> => {
      discoverRequests += 1
      assert.equal(String(input), "https://us.tiktok.com/node/share/discover/list")
      return new Response(JSON.stringify({
        statusCode: 0,
        errMsg: "",
        body: {
          discoverList: [
            {
              type: 3,
              title: "naturefindsweek",
              link: "https://www.tiktok.com/tag/naturefindsweek",
              isInternalLink: false
            },
            {
              type: 4,
              title: "The Assignment - taymoneyduh",
              link: "https://www.tiktok.com/music/The-Assignment-6990410706927536902",
              isInternalLink: false
            }
          ]
        }
      }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    }

    const fallback = await tiktokCollector.collect(target, undefined, {
      now: new Date("2026-09-22T04:00:00Z"),
      fetch: discoverFetch as typeof fetch
    })

    assert.equal(discoverRequests, 1)
    assert.equal(fallback.signals.length, 2)
    assert.equal(fallback.signals[0]?.title, "#naturefindsweek")
    assert.equal(fallback.signals[0]?.metadata.provider, "tiktok-web-discover")
    assert.equal(fallback.signals[0]?.metadata.contentType, "hashtag")
    assert.equal(fallback.signals[1]?.metadata.contentType, "music")
    assert.equal(fallback.nextCursor?.provider, "tiktok-web-discover")
  } finally {
    if (previousToken == null) delete process.env.APIFY_TOKEN
    else process.env.APIFY_TOKEN = previousToken
  }
})
