import assert from "node:assert/strict"
import test from "node:test"
import { itchCommentsUrl, parseItchCommentsCount, parseItchGameMetrics } from "./itch-metrics.js"

test("parseItchGameMetrics reads rating average and total", () => {
  const html = `<div>Rating Rated 4.9 out of 5 stars(315 total ratings)</div>`
  assert.deepEqual(parseItchGameMetrics(html), { ratingAverage: 4.9, ratings: 315 })
})

test("parseItchCommentsCount reads paginated totals", () => {
  const html = `<title>Comments 114 to 75 of 250 - Example</title><div>Viewing most recent comments 137 to 176 of 250</div>`
  assert.equal(parseItchCommentsCount(html), 250)
})

test("parseItchCommentsCount falls back to post containers for small threads", () => {
  const html = `<div class="community_post">one</div><div class="community_post reply">two</div>`
  assert.equal(parseItchCommentsCount(html), 2)
})

test("itchCommentsUrl appends the comments path", () => {
  assert.equal(
    itchCommentsUrl("https://creator.itch.io/my-game/?foo=bar#top"),
    "https://creator.itch.io/my-game/comments"
  )
})
