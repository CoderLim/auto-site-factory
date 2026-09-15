import assert from "node:assert/strict"
import test from "node:test"
import type { ExtractedEntity, StoredSignal } from "@factory/shared"
import { extractEntities, filterAmbiguousSingleWordEntities } from "./index.js"

function signal(input: Partial<StoredSignal> = {}): StoredSignal {
  return {
    id: "sig_quality",
    sourceType: "hn",
    sourceTargetId: "hn-viral",
    externalId: "1",
    discoveredAt: new Date("2026-09-15T00:00:00Z"),
    metadata: {},
    fingerprint: "quality",
    scope: "viral",
    ...input
  }
}

function other(name: string): ExtractedEntity {
  return {
    name,
    type: "OTHER",
    confidence: 0.9,
    evidence: name
  }
}

test("trusted direct game titles bypass generic sentence-fragment filtering", async () => {
  const title = "Don't Befriend The Class Nerd! [Free] [Visual Novel]"
  const result = await extractEntities(signal({
    sourceType: "rss",
    sourceTargetId: "rss-itch-visual-novel",
    title,
    metadata: {
      platform: "itch",
      directEntity: "Don't Befriend The Class Nerd!",
      entityType: "GAME"
    }
  }))

  assert.deepEqual(result.map((item) => [item.name, item.type]), [
    ["Don't Befriend The Class Nerd!", "GAME"]
  ])
})

test("drops ambiguous single-word OTHER entities without strong identity evidence", () => {
  for (const name of ["There", "Study", "Duo", "SQL", "Terminal"]) {
    const result = filterAmbiguousSingleWordEntities(
      [other(name)],
      signal({
        title: `${name} is getting attention this week`,
        url: "https://news.ycombinator.com/item?id=123"
      })
    )
    assert.equal(result.length, 0, name)
  }
})

test("keeps single-word OTHER entities with dedicated identity evidence", () => {
  const result = filterAmbiguousSingleWordEntities(
    [other("Belegio")],
    signal({
      title: "Belegio – Parsing grocery receipts down to the line item",
      url: "https://belegio.loobia.net/en"
    })
  )
  assert.equal(result.length, 1)
})

test("keeps Product Hunt title as strong single-word identity evidence", () => {
  const result = filterAmbiguousSingleWordEntities(
    [other("Muse")],
    signal({
      sourceType: "rss",
      sourceTargetId: "rss-producthunt-viral",
      title: "Muse",
      metadata: { platform: "producthunt" },
      url: "https://www.producthunt.com/products/muse-22"
    })
  )
  assert.equal(result.length, 1)
})

test("does not let an unrelated HN mention turn a Product Hunt-style common name into cross-source evidence", () => {
  const result = filterAmbiguousSingleWordEntities(
    [other("Muse")],
    signal({
      title: "Muse and creativity in modern software",
      url: "https://example.org/essay/muse-and-creativity"
    })
  )
  assert.equal(result.length, 0)
})
