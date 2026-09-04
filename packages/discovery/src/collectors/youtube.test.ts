import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { youtubeCollector } from "./youtube.js"

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015">
  <entry>
    <id>yt:video:omoggle123</id>
    <yt:videoId>omoggle123</yt:videoId>
    <title>xQc tries Omoggle for the first time</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=omoggle123" />
    <published>2026-09-04T03:00:00Z</published>
    <author><name>xQc</name></author>
  </entry>
</feed>`

const target: SourceTarget = {
  id: "youtube-atom-test",
  sourceType: "youtube",
  name: "xQc YouTube",
  scope: "viral",
  enabled: true,
  config: {
    channelId: "UCmDTrq0LNgPodDOFZiSbsww",
    baselineOnFirstRun: false,
    maxResults: 25
  }
}

test("YouTube collector uses public Atom feed without an API key", async () => {
  let requestedUrl = ""
  const result = await youtubeCollector.collect(target, { seenIds: [] }, {
    now: new Date("2026-09-04T04:00:00Z"),
    fetch: async (input) => {
      requestedUrl = String(input)
      return new Response(atom, { status: 200 })
    }
  })

  assert.match(requestedUrl, /youtube\.com\/feeds\/videos\.xml\?channel_id=/)
  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.sourceType, "youtube")
  assert.equal(result.signals[0]?.title, "xQc tries Omoggle for the first time")
  assert.equal(result.signals[0]?.metadata.transport, "atom")
})
