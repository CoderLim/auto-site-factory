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

test("drops plain viral noise and source boilerplate", () => {
  for (const name of [
    "THIS", "WHAT", "SH", "DUMBEST", "DHS", "RAW", "Email", "Gambling", "Reddit", "Finland",
    "Switzerland", "Service", "option", "Ask HN", "Show HN", "MacRumors", "A.I", "v0.1"
  ]) {
    assert.equal(isHighQualityViralEntity(entity(name), signal({ title: `${name} is in the news` })), false, name)
  }
})

test("drops mature roots and partial variants, keeps the full specific model", () => {
  const title = "iPhone 18 Pro Introduces 'Apple Reference Image' to Verify Photo Authenticity"
  assert.equal(isHighQualityViralEntity(entity("iPhone"), signal({ sourceType: "hn", title })), false)
  assert.equal(isHighQualityViralEntity(entity("iPhone 18"), signal({ sourceType: "hn", title })), false)
  assert.equal(isHighQualityViralEntity(entity("iPhone 18 Pro"), signal({ sourceType: "hn", title })), true)

  assert.equal(
    isHighQualityViralEntity(entity("AirPods"), signal({ sourceType: "hn", title: "AirPods 5" })),
    false
  )
  assert.equal(
    isHighQualityViralEntity(entity("AirPods 5"), signal({ sourceType: "hn", title: "AirPods 5" })),
    true
  )
  assert.equal(
    isHighQualityViralEntity(entity("Apple Watch Series"), signal({ sourceType: "hn", title: "Apple Watch Series 12" })),
    false
  )
})

test("keeps a newly announced multi-word product but drops its mature root", () => {
  const techmeme = signal({
    sourceType: "rss",
    sourceTargetId: "rss-techmeme-viral",
    metadata: { platform: "techmeme" },
    title: "Apple unveils AppleCare One Family, extending AppleCare coverage to every eligible device",
    url: "https://www.techmeme.com/260909/p50#a260909p50"
  })
  assert.equal(isHighQualityViralEntity(entity("AppleCare"), techmeme), false)
  assert.equal(isHighQualityViralEntity(entity("AppleCare One Family"), techmeme), true)
  assert.equal(isHighQualityViralEntity(entity("MacRumors"), techmeme), false)
})

test("drops article titles, institutions and mature projects without launch evidence", () => {
  const cases: Array<[string, string, string]> = [
    ["A.I. Is Outsmarting Its Creators", "A.I. Is Outsmarting Its Creators – The Daily", "https://overcast.fm/+ABLPtsqdPGs"],
    ["FreeBSD", "FreeBSD working on new service manager", "https://www.osnews.com/story/145933/freebsd-working-on-new-service-manager/"],
    ["National Archives", "National Archives locations set to close without tribal consultation", "https://ictnews.org/news/these-records-are-priceless-3-national-archives-locations-set-to-close-without-tribal-consultation/"],
    ["Distributed System", "Time, Clocks, and the Ordering of Events in a Distributed System (1978) [pdf]", "https://lamport.azurewebsites.net/pubs/time-clocks.pdf"],
    ["Lean4", "Natural Number Game (Lean4 Tutorial)", "https://adam.math.hhu.de/#/g/hhu-adam/NNG4"],
    ["Microsoft Surface Duo", "Microsoft Surface Duo", "https://news.microsoft.com/surfaceduo/"],
    ["Van Halen Test", "Van Halen Test", "https://en.wikipedia.org/wiki/Van_Halen_test"]
  ]
  for (const [name, title, url] of cases) {
    assert.equal(isHighQualityViralEntity(entity(name), signal({ sourceType: "hn", title, url })), false, name)
  }
})

test("drops possessive fragments from news headlines", () => {
  assert.equal(isHighQualityViralEntity(entity("Apple Watch's"), signal({ title: "Apple Watch's new feature listens to your chats" })), false)
  assert.equal(isHighQualityViralEntity(entity("Trezor's Email"), signal({ title: "Trezor's Email provider has been breached" })), false)
  assert.equal(isHighQualityViralEntity(entity("Meta's"), signal({ title: "Muse, Meta's new AI agent" })), false)
})

test("keeps concrete HN launches and dedicated-domain entities", () => {
  const keep: Array<[string, string, string]> = [
    ["Belegio", "Belegio – Parsing grocery receipts down to the line item", "https://belegio.loobia.net/en"],
    ["Spacefast", "Spacefast: Hosting for Agent Publishing", "https://spacefast.com/"],
    ["Agent Router", "Agent Router: Powerful traffic handling for agent builders", "https://aaif.io/blog/agent-router-powerful-traffic-handling-for-agent-builders"],
    ["WeWorm", "WeWorm", "https://calif.io/research/weworm"],
    ["Screenmap", "Screenmap", "https://screenmap.dev/"],
    ["Playship", "Playship – idea to published Android app, automated", "https://playship.dev/"],
    ["RyTuneX 1.7.1", "RyTuneX 1.7.1: open-source Windows 10/11 optimizer adds per-item rollback", "https://github.com/rayenghanmi/RyTuneX"],
    ["Multigres v0.1", "Multigres v0.1 Alpha: an operating system for Postgres", "https://supabase.com/blog/multigres-v0-1-alpha"]
  ]
  for (const [name, title, url] of keep) {
    assert.equal(isHighQualityViralEntity(entity(name), signal({ sourceType: "hn", title, url })), true, name)
  }
})

test("keeps Show HN names even when the brand is a common-looking word", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Kin"), signal({
      sourceType: "hn",
      title: "Show HN: Kin – A code repository built for AI and the people working with it",
      url: "https://github.com/firelock-ai/kin"
    })),
    true
  )
  assert.equal(
    isHighQualityViralEntity(entity("PCalen"), signal({
      sourceType: "hn",
      title: "Show HN: PCalen – Generate free printable calendar in seconds",
      url: "https://pcalen.com/"
    })),
    true
  )
})

test("keeps coined single-word names in usage context", () => {
  assert.equal(isHighQualityViralEntity(entity("Omoggle"), signal({ title: "xQc tries Omoggle for the first time" })), true)
  assert.equal(isHighQualityViralEntity(entity("Omoggle"), signal({ title: "New Omoggle update is everywhere" })), true)
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

test("does not change non-viral extraction", () => {
  assert.equal(isHighQualityViralEntity(entity("DHS"), signal({ scope: "games", title: "DHS" })), true)
})
