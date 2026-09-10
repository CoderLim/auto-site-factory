import assert from "node:assert/strict"
import test from "node:test"
import type { StoredSignal } from "@factory/shared"
import { extractEntities } from "./index.js"

function viralSignal(input: Partial<StoredSignal>): StoredSignal {
  return {
    id: `sig_${Math.random().toString(36).slice(2)}`,
    sourceType: "hn",
    sourceTargetId: "hn-newstories-viral",
    externalId: "1",
    discoveredAt: new Date("2026-09-10T01:35:11Z"),
    metadata: { platform: "hn" },
    fingerprint: "viral-integration",
    scope: "viral",
    ...input
  }
}

async function names(input: Partial<StoredSignal>): Promise<string[]> {
  return (await extractEntities(viralSignal(input))).map((item) => item.name)
}

test("Techmeme announcement yields the specific new product only", async () => {
  const result = await names({
    sourceType: "rss",
    sourceTargetId: "rss-techmeme-viral",
    metadata: { platform: "techmeme" },
    title: "Apple unveils AppleCare One Family, extending AppleCare coverage to every eligible device in an Apple Family Sharing group of up to 6 people for $49.99/month (Hartley Charlton/MacRumors)",
    content: "Hartley Charlton / MacRumors : Apple unveils AppleCare One Family, extending AppleCare coverage to every eligible device. Apple today announced AppleCare One Family, a new option for U.S. customers.",
    url: "https://www.techmeme.com/260909/p50#a260909p50"
  })
  assert.deepEqual(result, ["AppleCare One Family"])
})

test("HN article noise produces no viral entity", async () => {
  const noisy = [
    ["A Blacklisted Chinese Tech Giant Kept Buying Nvidia's Best A.I. Chips", "https://www.nytimes.com/2026/09/06/technology/ai-chips-china-blacklist.html"],
    ["FreeBSD working on new service manager", "https://www.osnews.com/story/145933/freebsd-working-on-new-service-manager/"],
    ["Use This New Service to Find Out Who's Tracking You", "https://krebsonsecurity.com/2026/08/whos-tracking-you-use-this-new-service-to-find-out/"],
    ["A.I. Is Outsmarting Its Creators – The Daily", "https://overcast.fm/+ABLPtsqdPGs"],
    ["National Archives locations set to close without tribal consultation", "https://ictnews.org/news/these-records-are-priceless-3-national-archives-locations-set-to-close-without-tribal-consultation/"],
    ["Time, Clocks, and the Ordering of Events in a Distributed System (1978) [pdf]", "https://lamport.azurewebsites.net/pubs/time-clocks.pdf"],
    ["Natural Number Game (Lean4 Tutorial)", "https://adam.math.hhu.de/#/g/hhu-adam/NNG4"],
    ["Trezor's Email provider has been breached", "https://twitter.com/CR1337/status/2097841222954184954"]
  ] as const

  for (const [title, url] of noisy) {
    assert.deepEqual(await names({ title, url }), [], title)
  }
})

test("specific new versions stay intact", async () => {
  const iphone = await names({
    title: "iPhone 18 Pro Introduces 'Apple Reference Image' to Verify Photo Authenticity",
    url: "https://www.macrumors.com/2026/09/09/apple-reference-image/"
  })
  assert.ok(iphone.includes("iPhone 18 Pro"), String(iphone))
  assert.ok(iphone.includes("Apple Reference Image"), String(iphone))
  assert.ok(!iphone.includes("iPhone 18"), String(iphone))

  assert.deepEqual(await names({
    title: "Multigres v0.1 Alpha: an operating system for Postgres",
    url: "https://supabase.com/blog/multigres-v0-1-alpha"
  }), ["Multigres v0.1"])
})

test("real HN product-like candidates survive", async () => {
  const cases: Array<[string, string, string]> = [
    ["Belegio – Parsing grocery receipts down to the line item", "https://belegio.loobia.net/en", "Belegio"],
    ["Spacefast: Hosting for Agent Publishing", "https://spacefast.com/", "Spacefast"],
    ["WeWorm", "https://calif.io/research/weworm", "WeWorm"],
    ["Screenmap", "https://screenmap.dev/", "Screenmap"],
    ["Playship – idea to published Android app, automated", "https://playship.dev/", "Playship"],
    ["RyTuneX 1.7.1: open-source Windows 10/11 optimizer adds per-item rollback", "https://github.com/rayenghanmi/RyTuneX", "RyTuneX 1.7.1"],
    ["Show HN: PCalen – Generate free printable calendar in seconds", "https://pcalen.com/", "PCalen"],
    ["Show HN: Rayrun – one MCP gateway for the whole company", "https://ray.run/", "Rayrun"],
    ["Show HN: EmbedFlow –> Upgrade embedding models without re-embedding your corpus", "https://github.com/arnsri33/embedflow", "EmbedFlow"],
    ["Show HN: Kin – A code repository built for AI and the people working with it", "https://github.com/firelock-ai/kin", "Kin"]
  ]

  for (const [title, url, expected] of cases) {
    const result = await names({ title, url })
    assert.ok(result.includes(expected), `${title} -> ${result.join(", ")}`)
  }
})

test("old or ambiguous exact-title entities do not pass without concrete novelty evidence", async () => {
  const cases = [
    ["Microsoft Surface Duo", "https://news.microsoft.com/surfaceduo/"],
    ["Van Halen Test", "https://en.wikipedia.org/wiki/Van_Halen_test"],
    ["Lean Game Server", "https://adam.math.hhu.de/#/"],
    ["Epstein Tycoon", "https://www.reddit.com/r/aigamedev/s/Hj6oRheiQw"]
  ] as const
  for (const [title, url] of cases) {
    assert.deepEqual(await names({ title, url }), [], title)
  }
})
