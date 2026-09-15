import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { parseFeed, rssCollector, stripTrailingBracketMetadata } from "./rss.js"

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

const encodedRss = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Don&#039;t Befriend The Class Nerd! [Free] [Visual Novel]</title>
    <link>https://example.itch.io/dont-befriend</link>
    <guid>encoded-1</guid>
  </item>
</channel></rss>`

const itchRss = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title><![CDATA[Merrilend [Free] [Visual Novel]]]></title>
    <link>https://alexchichi.itch.io/merrilend</link>
    <guid>itch-1</guid>
    <pubDate>Mon, 14 Sep 2026 14:44:19 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[ECHO DIMENSION [$4.99] [Rhythm]]]></title>
    <link>https://ligen19910313.itch.io/echo-dimension</link>
    <guid>itch-2</guid>
    <pubDate>Mon, 14 Sep 2026 15:41:02 GMT</pubDate>
  </item>
  <item>
    <title><![CDATA[Bounty or Booty [Free] [Visual Novel] [Windows] [Linux]]]></title>
    <link>https://doksa.itch.io/bounty-or-booty</link>
    <guid>itch-3</guid>
    <pubDate>Sun, 30 Mar 2025 20:48:55 GMT</pubDate>
  </item>
</channel></rss>`

test("parseFeed supports RSS and Atom", () => {
  assert.equal(parseFeed(rss)[0]?.title, "Trying Omoggle for the first time")
  assert.equal(parseFeed(atom)[0]?.author, "xQc")
  assert.equal(parseFeed(atom)[0]?.link, "https://youtube.com/watch?v=abc")
})

test("parseFeed decodes zero-padded numeric apostrophe entities", () => {
  assert.equal(parseFeed(encodedRss)[0]?.title, "Don't Befriend The Class Nerd! [Free] [Visual Novel]")
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

test("stripTrailingBracketMetadata removes itch listing metadata", () => {
  assert.equal(stripTrailingBracketMetadata("Merrilend [Free] [Visual Novel]"), "Merrilend")
  assert.equal(stripTrailingBracketMetadata("Platform Edge [Free] [Visual Novel] [Windows] [macOS]"), "Platform Edge")
})

test("RSS collector filters itch entries by category and freshness and cleans entity name", async () => {
  const itchTarget: SourceTarget = {
    ...target,
    id: "rss-itch-test",
    config: {
      ...target.config,
      platform: "itch",
      directEntity: true,
      entityType: "GAME",
      directEntityStripBracketSuffix: true,
      titleIncludes: ["[Visual Novel]"],
      maxAgeHours: 72
    }
  }
  const result = await rssCollector.collect(itchTarget, { seenIds: [] }, {
    now: new Date("2026-09-15T02:00:00Z"),
    fetch: async () => new Response(itchRss, { status: 200 })
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.title, "Merrilend [Free] [Visual Novel]")
  assert.equal(result.signals[0]?.metadata.directEntity, "Merrilend")
})
