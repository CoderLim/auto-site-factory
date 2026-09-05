import assert from "node:assert/strict"
import test from "node:test"
import { scoreSteamOpportunity, shouldPromoteSteamOpportunity } from "./opportunity.js"

test("promotes a WARDOGS-style pre-release game to P0", () => {
  const result = scoreSteamOpportunity({
    followersCurrent: 146_963,
    storeStatus: "coming_soon",
    releaseDate: "2026-09-10",
    hasDemo: false,
    hasPlaytest: true,
    opportunityReason: "playtest"
  }, new Date("2026-09-02T00:00:00Z"))

  assert.equal(result.priority, "P0")
  assert.equal(result.score, 75)
  assert.equal(shouldPromoteSteamOpportunity(result), true)
  assert.deepEqual(result.reasons, ["followers_100k_plus", "playtest_live", "release_within_14d"])
})

test("does not promote a low-signal demo just because a demo exists", () => {
  const result = scoreSteamOpportunity({
    followersCurrent: 48,
    storeStatus: "coming_soon",
    releaseDate: "2026-11-04",
    hasDemo: true,
    hasPlaytest: false,
    opportunityReason: "demo"
  }, new Date("2026-09-02T00:00:00Z"))

  assert.equal(result.priority, "P3")
  assert.equal(shouldPromoteSteamOpportunity(result), false)
})

test("promotes strong follower velocity even before release", () => {
  const result = scoreSteamOpportunity({
    followersCurrent: 8_000,
    followers7dDelta: 4_500,
    followers7dGrowthPct: 128,
    storeStatus: "coming_soon",
    releaseDate: "2026-10-20",
    hasDemo: false,
    hasPlaytest: true,
    opportunityReason: "follower_spike"
  }, new Date("2026-09-02T00:00:00Z"))

  assert.equal(result.priority, "P0")
  assert.equal(shouldPromoteSteamOpportunity(result), true)
})
