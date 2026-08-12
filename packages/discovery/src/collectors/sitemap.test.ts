import assert from "node:assert/strict"
import test from "node:test"
import { parseSitemapUrls } from "./sitemap.js"

test("parseSitemapUrls extracts loc entries", () => {
  const xml = `<urlset><url><loc>https://a.com/a</loc></url><url><loc>https://a.com/b?x=1&amp;y=2</loc></url></urlset>`
  assert.deepEqual(parseSitemapUrls(xml), ["https://a.com/a", "https://a.com/b?x=1&y=2"])
})
