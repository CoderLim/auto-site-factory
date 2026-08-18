import assert from "node:assert/strict"
import test from "node:test"
import type { SourceTarget } from "@factory/shared"
import { parseCatalog, wikiGgCollector } from "./wiki-gg.js"

const target: SourceTarget = {
  id: "wiki-gg-discovery",
  sourceType: "wiki_gg",
  name: "wiki.gg New Wikis",
  scope: "games",
  enabled: true,
  config: {
    urls: ["https://www.wiki.gg/wikis"],
    baselineOnFirstRun: true,
    minWikiCount: 2
  }
}

const initialHtml = `
  <a href="https://palworld.wiki.gg/">Palworld Wiki</a>
  <a href="/wikis/terraria">Terraria Wiki</a>
`

const updatedHtml = `
  ${initialHtml}
  <a href="https://new-game.wiki.gg/">New Game Wiki</a>
`

function fetchHtml(html: string): typeof fetch {
  return async () => new Response(html, {
    status: 200,
    headers: { "content-type": "text/html" }
  })
}

test("wiki.gg parser accepts subdomain and /wikis/ links", () => {
  assert.deepEqual(parseCatalog(initialHtml), [
    { slug: "palworld", name: "Palworld" },
    { slug: "terraria", name: "Terraria" }
  ])
})

test("wiki.gg collector establishes a baseline without backfilling old wikis", async () => {
  const result = await wikiGgCollector.collect(target, undefined, {
    now: new Date("2026-08-18T14:00:00.000Z"),
    fetch: fetchHtml(initialHtml)
  })

  assert.equal(result.signals.length, 0)
  assert.deepEqual(result.nextCursor?.wikiSlugs, ["palworld", "terraria"])
  assert.equal(result.nextCursor?.baselineEstablished, true)
})

test("wiki.gg collector emits only newly observed wikis after baseline", async () => {
  const result = await wikiGgCollector.collect(target, {
    wikiSlugs: ["palworld", "terraria"]
  }, {
    now: new Date("2026-08-18T15:00:00.000Z"),
    fetch: fetchHtml(updatedHtml)
  })

  assert.equal(result.signals.length, 1)
  assert.equal(result.signals[0]?.externalId, "new-game")
  assert.equal(result.signals[0]?.metadata.directEntity, "New Game")
  assert.equal(result.signals[0]?.metadata.entityType, "GAME")
  assert.equal(result.signals[0]?.url, "https://new-game.wiki.gg/")
})

test("wiki.gg collector falls back when the primary catalog is blocked", async () => {
  const fallbackTarget: SourceTarget = {
    ...target,
    config: {
      ...target.config,
      urls: ["https://blocked.test", "https://fallback.test"]
    }
  }
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes("blocked.test")) return new Response("Forbidden", { status: 403 })
    return new Response(JSON.stringify([
      { id: "palworld", name: "Palworld", lang: ["en"] },
      { id: "terraria", name: "Terraria", lang: ["en"] }
    ]), { status: 200, headers: { "content-type": "application/json" } })
  }

  const result = await wikiGgCollector.collect(fallbackTarget, undefined, {
    now: new Date("2026-08-18T16:00:00.000Z"),
    fetch: fetchImpl
  })

  assert.equal(result.signals.length, 0)
  assert.equal(result.nextCursor?.catalogSource, "https://fallback.test")
  assert.deepEqual(result.nextCursor?.wikiSlugs, ["palworld", "terraria"])
})
