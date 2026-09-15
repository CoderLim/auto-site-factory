import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { parseFeed, rssCollector } from "./rss.js"

const target: SourceTarget = {
  id: "rss-test",
  sourceType: "rss",
  name: "RSS Test",
  scope: "viral",
  enabled: true,
  config: {
    feedUrl: "https://example.test/feed.xml",
    baselineOnFirstRun: false
  }
}

const rss = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Trying Omoggle for the first time]]></title>
    <link>https://example.test/omoggle</link>
    <guid>post-1</guid>
    <pubDate>Fri, 04 Sep 2026 03:00:00 GMT</pubDate>
    <description><![CDATA[<p>A new viral site.</p>]]></description>
  </item>
</channel></rss>`

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:abc</id>
    <title>xQc tries Omoggle</title>
    <link rel="alternate" href="https://youtube.com/watch?v=abc" />
    <published>2026-09-04T03:00:00Z</published>
    <author><name>xQc</name></author>
  </entry>
</feed>`

test("parseFeed supports RSS and Atom", () => {
  assert.equal(parseFeed(rss)[0]?.title, "Trying Omoggle for the first time")
  assert.equal(parseFeed(atom)[0]?.author, "xQc")
  assert.equal(parseFeed(atom)[0]?.link, "https://youtube.com/watch?v=abc")
})

test("RSS collector emits unseen entries", async () => {
  const result = await rssCollector.collect(target, { seenIds: [] }, {
    now: new Date("2026-09-04T04:00:00Z"),
    fetch: async () => new Response(rss, { status: 200 })
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.title, "Trying Omoggle for the first time")
  assert.equal(result.signals[0]?.sourceType, "rss")
})

test("RSS collector can mark feed titles as trusted direct entities", async () => {
  const directTarget: SourceTarget = {
    ...target,
    id: "rss-itch-test",
    config: {
      ...target.config,
      platform: "itch",
      directEntity: true,
      entityType: "GAME"
    }
  }
  const result = await rssCollector.collect(directTarget, { seenIds: [] }, {
    now: new Date("2026-09-04T04:00:00Z"),
    fetch: async () => new Response(rss, { status: 200 })
  })

  assert.equal(result.signals[0]?.metadata.platform, "itch")
  assert.equal(result.signals[0]?.metadata.directEntity, "Trying Omoggle for the first time")
  assert.equal(result.signals[0]?.metadata.entityType, "GAME")
})
