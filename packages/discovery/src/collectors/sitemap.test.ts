import assert from "node:assert/strict"
import test from "node:test"
import { gzipSync } from "node:zlib"
import type { StoredSignal } from "@factory/shared"
import { extractEntities } from "../extraction/index.js"
import {
  decodeSitemapBytes,
  extractKeywordFromUrl,
  parseSitemapDocument,
  resolveSitemapEntityName
} from "./sitemap.js"

test("parseSitemapDocument parses urlset and decodes XML entities", () => {
  const parsed = parseSitemapDocument(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.com/a</loc><image:image><image:loc>https://a.com/a.jpg</image:loc></image:image></url><url><loc>https://a.com/b?x=1&amp;y=2</loc></url></urlset>`)
  assert.equal(parsed.kind, "urlset")
  assert.deepEqual(parsed.locs, ["https://a.com/a", "https://a.com/b?x=1&y=2"])
})

test("parseSitemapDocument parses sitemap indexes", () => {
  const parsed = parseSitemapDocument(`<sitemapindex><sitemap><loc>https://a.com/1.xml</loc></sitemap><sitemap><loc>https://a.com/2.xml</loc></sitemap></sitemapindex>`)
  assert.equal(parsed.kind, "sitemapindex")
  assert.deepEqual(parsed.locs, ["https://a.com/1.xml", "https://a.com/2.xml"])
})

test("parseSitemapDocument accepts plain text sitemap", () => {
  const parsed = parseSitemapDocument(`# generated\nhttps://a.com/one\nhttps://a.com/two\n`)
  assert.equal(parsed.kind, "urlset")
  assert.deepEqual(parsed.locs, ["https://a.com/one", "https://a.com/two"])
})

test("decodeSitemapBytes transparently handles gzip", () => {
  const xml = `<urlset><url><loc>https://a.com/a</loc></url></urlset>`
  assert.equal(decodeSitemapBytes(gzipSync(xml)), xml)
})

test("extractKeywordFromUrl carries over sitemap-monitor slug rules", () => {
  assert.equal(extractKeywordFromUrl("https://a.com/play/dangerous-danny"), "dangerous danny")
  assert.equal(extractKeywordFromUrl("https://a.com/app/car-destruction-king-342970"), "car destruction king")
  assert.equal(extractKeywordFromUrl("https://a.com/123456"), undefined)
  assert.equal(extractKeywordFromUrl("https://a.com/hello-world.html"), "hello world")
})

test("resolveSitemapEntityName confirms names from H1 or page title", () => {
  assert.deepEqual(
    resolveSitemapEntityName("food jam", { h1: "Food Jam", pageTitle: "Food Jam | Play Online" }),
    { name: "Food Jam", source: "h1" }
  )
  assert.deepEqual(
    resolveSitemapEntityName("glass break", { pageTitle: "Glass Break - Play Online" }),
    { name: "Glass Break", source: "title" }
  )
})

test("resolveSitemapEntityName accepts H1/title agreement even when slug changed", () => {
  assert.deepEqual(
    resolveSitemapEntityName("old-game-slug", { h1: "Renamed Game", pageTitle: "Renamed Game | Playhop" }),
    { name: "Renamed Game", source: "h1_title" }
  )
})

test("resolveSitemapEntityName does not trust a slug unless the target opts in", () => {
  assert.deepEqual(resolveSitemapEntityName("food for ants", {}), {})
  assert.deepEqual(
    resolveSitemapEntityName("food for ants", {}, true),
    { name: "food for ants", source: "trusted_url_slug" }
  )
})

test("unconfirmed sitemap signals do not become heuristic entities", async () => {
  const signal: StoredSignal = {
    id: "sig_test",
    sourceType: "sitemap",
    sourceTargetId: "sitemap-test",
    scope: "web-games",
    externalId: "https://example.com/games/top-games",
    title: "Top Games",
    url: "https://example.com/games/top-games",
    discoveredAt: new Date("2026-09-17T00:00:00Z"),
    metadata: {
      keyword: "top games",
      entityCandidate: "top games",
      entityValidation: "unconfirmed"
    },
    fingerprint: "sitemap:test"
  }

  assert.deepEqual(await extractEntities(signal), [])
})
