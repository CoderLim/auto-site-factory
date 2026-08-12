import assert from "node:assert/strict"
import test from "node:test"
import { normalizeEntityName } from "./normalize.js"

test("normalizer preserves model/version distinctions", () => {
  assert.equal(normalizeEntityName(" GPT-5.1 "), "gpt-5.1")
  assert.notEqual(normalizeEntityName("GPT-5.1"), normalizeEntityName("GPT-5.2"))
})

test("normalizer collapses whitespace and unicode width", () => {
  assert.equal(normalizeEntityName("Ｎａｎｏ   Banana 2"), "nano banana 2")
})
