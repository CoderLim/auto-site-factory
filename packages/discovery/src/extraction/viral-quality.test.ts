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

test("drops plain one-word viral noise without naming evidence", () => {
  for (const name of ["THIS", "WHAT", "SH", "DUMBEST", "DHS", "Switzerland"]) {
    assert.equal(isHighQualityViralEntity(entity(name), signal({ title: `${name} is in the news` })), false, name)
  }
})

test("keeps coined single-word names in explicit naming context", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Omoggle"), signal({ title: "xQc tries Omoggle for the first time" })),
    true
  )
  assert.equal(
    isHighQualityViralEntity(entity("Omoggle"), signal({ title: "New Omoggle update is everywhere" })),
    true
  )
})

test("keeps a plain brand when the outbound domain backs the entity", () => {
  assert.equal(
    isHighQualityViralEntity(entity("Lovable"), signal({
      title: "I used a new builder today",
      metadata: { outboundUrl: "https://lovable.dev/projects" }
    })),
    true
  )
})

test("keeps brand-shaped single tokens and multi-word product names", () => {
  assert.equal(isHighQualityViralEntity(entity("TermRover"), signal({ title: "TermRover" })), true)
  assert.equal(isHighQualityViralEntity(entity("ORC8R"), signal({ title: "ORC8R" })), true)
  assert.equal(isHighQualityViralEntity(entity("Matcha Filter"), signal({ title: "Matcha Filter launch" })), true)
})

test("does not change non-viral extraction", () => {
  assert.equal(
    isHighQualityViralEntity(entity("DHS"), signal({ scope: "games", title: "DHS" })),
    true
  )
})
