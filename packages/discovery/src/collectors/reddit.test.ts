import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { redditCollector } from "./reddit.js"

const target: SourceTarget = {
  id: "reddit-sideproject-test",
  sourceType: "reddit",
  name: "Reddit SideProject",
  scope: "viral",
  enabled: true,
  config: {
    subreddit: "SideProject",
    listing: "new",
    limit: 25,
    maxPages: 1,
    baselineOnFirstRun: false,
    platform: "reddit",
    sourceRole: "discovery",
    keylessIntervalMs: 0
  }
}

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>t3_xyz789</id>
    <title>I built FreshTool</title>
    <author><name>/u/maker789</name></author>
    <link rel="alternate" href="https://www.reddit.com/r/SideProject/comments/xyz789/freshtool/" />
    <published>2026-09-15T03:30:00Z</published>
    <content type="html"><![CDATA[FreshTool launched today.]]></content>
  </entry>
</feed>`

test("Reddit collector uses the public RSS feed when no OAuth token is configured", async () => {
  let requestedUrl = ""
  let authorization = ""
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input)
    authorization = new Headers(init?.headers).get("authorization") ?? ""
    return new Response(atom, { status: 200, headers: { "content-type": "application/atom+xml" } })
  }

  const result = await redditCollector.collect(target, undefined, {
    now: new Date("2026-09-15T04:00:00Z"),
    fetch: fetchImpl
  })

  assert.match(requestedUrl, /^https:\/\/www\.reddit\.com\/r\/SideProject\/new\/\.rss\?/)
  assert.equal(authorization, "")
  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.externalId, "xyz789")
  assert.equal(result.signals[0]?.author, "maker789")
  assert.equal(result.signals[0]?.url, "https://www.reddit.com/r/SideProject/comments/xyz789/freshtool/")
  assert.equal(result.signals[0]?.metadata.platform, "reddit")
  assert.equal(result.signals[0]?.metadata.transport, "rss")
  assert.equal(result.nextCursor?.lastSeenFullname, "t3_xyz789")
})

test("Reddit collector can baseline the first RSS run", async () => {
  const fetchImpl: typeof fetch = async () => new Response(atom, {
    status: 200,
    headers: { "content-type": "application/atom+xml" }
  })

  const result = await redditCollector.collect({
    ...target,
    config: { ...target.config, baselineOnFirstRun: true }
  }, undefined, {
    now: new Date("2026-09-15T04:00:00Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 0)
  assert.equal(result.nextCursor?.lastSeenFullname, "t3_xyz789")
})

test("Reddit collector preserves engagement when OAuth JSON is configured", async () => {
  process.env.TEST_REDDIT_TOKEN = "token-123"
  try {
    let requestedUrl = ""
    let authorization = ""
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input)
      authorization = new Headers(init?.headers).get("authorization") ?? ""
      return new Response(JSON.stringify({
        data: {
          after: null,
          children: [{
            data: {
              id: "abc123",
              name: "t3_abc123",
              title: "I built Invoala",
              selftext: "A free invoice generator.",
              author: "maker123",
              created_utc: 1788490800,
              permalink: "/r/SideProject/comments/abc123/i_built_invoala/",
              url: "https://invoala.com",
              url_overridden_by_dest: "https://invoala.com",
              domain: "invoala.com",
              score: 12,
              ups: 12,
              num_comments: 7,
              upvote_ratio: 0.93,
              num_crossposts: 2,
              is_self: false
            }
          }]
        }
      }), { status: 200, headers: { "content-type": "application/json" } })
    }

    const result = await redditCollector.collect({
      ...target,
      config: { ...target.config, tokenEnv: "TEST_REDDIT_TOKEN" }
    }, undefined, {
      now: new Date("2026-09-04T04:00:00Z"),
      fetch: fetchImpl
    })

    assert.match(requestedUrl, /^https:\/\/oauth\.reddit\.com\/r\/SideProject\/new\?/)
    assert.equal(authorization, "Bearer token-123")
    assert.equal(result.signals.length, 1)
    assert.equal(result.signals[0]?.metadata.score, 12)
    assert.equal(result.signals[0]?.metadata.numComments, 7)
    assert.equal(result.signals[0]?.metadata.upvoteRatio, 0.93)
    assert.equal(result.signals[0]?.metadata.outboundUrl, "https://invoala.com")
    assert.equal(result.signals[0]?.metadata.transport, "oauth-json")
  } finally {
    delete process.env.TEST_REDDIT_TOKEN
  }
})
