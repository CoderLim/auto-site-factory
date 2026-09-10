import assert from "node:assert/strict"
import test from "node:test"
import type { ExtractedEntity, StoredSignal } from "@factory/shared"
import { isHighQualityViralEntity } from "./viral-quality.js"

function signal(input: Partial<StoredSignal> = {}): StoredSignal {
  return {
    id: "sig_viral",
    sourceType: "reddit",
    sourceTargetId: "reddit-sideproject",
    externalId: "1",
    discoveredAt: new Date("2026-09-10T00:00:00Z"),
    metadata: {},
    fingerprint: "viral-quality",
    scope: "viral",
    ...input
  }
}

function entity(name: string, input: Partial<ExtractedEntity> = {}): ExtractedEntity {
  return {
    name,
    type: "OTHER",
    confidence: 0.64,
    evidence: name,
    ...input
  }
}

test("drops plain one-word viral noise without entity evidence", () => {
  for (const name of ["THIS", "WHAT", "SH", "DUMBEST", "DHS", "RAW", "Email", "Gambling", "Reddit", "Finland", "Switzerland"]) {
    assert.equal(isHighQualityViralEntity(entity(name), signal({ title: `${name} is in the news` })), false, name)
  }
})

test("drops mature root names but keeps a new specific variant", () => {
  assert.equal(
    isHighQualityViralEntity(entity("AirPods"), signal({
      sourceType: "hn",
      title: "Apple Introduces AirPods 5",
      url: "https://www.apple.com/newsroom/2026/09/apple-introduces-airpods-5/"
    })),
    false
  )
  assert.equal(
    isHighQualityViralEntity(entity("AirPods 5"), signal({
      sourceType: "hn",
      title: "AirPods 5",
      url: "https://www.apple.com/airpods-5/"
    })),
    true
  )
})

test("drops a partial entity when the title contains a more specific numbered variant", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Apple Watch Series"), signal({
      sourceType: "hn",
      title: "Apple Watch Series 12",
      url: "https://www.apple.com/apple-watch-series-12/"
    })),
    false
  )
})

test("keeps coined single-word names in usage context", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Omoggle"), signal({ title: "xQc tries Omoggle for the first time" })),
    true
  )
  assert.equal(
    isHighQualityViralEntity(entity("Omoggle"), signal({ title: "New Omoggle update is everywhere" })),
    true
  )
})

test("keeps a plain brand when the outbound URL backs the entity", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Emailclaw"), signal({
      sourceType: "hn",
      title: "Show HN: Emailclaw–Email lovers' AI agent",
      url: "https://github.com/emailclaw/emailclaw"
    })),
    true
  )
})

test("keeps Product Hunt title as an explicit launch entity", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Muse"), signal({
      sourceType: "rss",
      sourceTargetId: "rss-producthunt-viral",
      title: "Muse",
      metadata: { platform: "producthunt" },
      url: "https://www.producthunt.com/products/muse-22"
    })),
    true
  )
})

test("keeps brand-shaped and launch-context product names", () => {
  assert.equal(isHighQualityViralEntity(entity("TermRover"), signal({ title: "TermRover – terminal browsing" })), true)
  assert.equal(isHighQualityViralEntity(entity("ORC8R"), signal({ title: "ORC8R" })), true)
  assert.equal(isHighQualityViralEntity(entity("Matcha Filter"), signal({ title: "Matcha Filter launch" })), true)
  assert.equal(isHighQualityViralEntity(entity("iPhone Duo"), signal({
    title: "iPhone Duo",
    url: "https://www.apple.com/iphone-duo/"
  })), true)
})

test("does not change non-viral extraction", () => {
  assert.equal(
    isHighQualityViralEntity(entity("DHS"), signal({ scope: "games", title: "DHS" })),
    true
  )
})
