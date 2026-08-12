import type { StoredSignal } from "@factory/shared"

const LOW_VALUE_ONLY = /^(update|patch|news|announcement|release|guide|wiki|codes?|tier list)$/i

export function shouldProcessSignal(signal: StoredSignal): boolean {
  const text = `${signal.title ?? ""} ${signal.content ?? ""}`.trim()
  if (text.length < 2) return false
  if (text.length > 120_000) return true
  if (signal.title && LOW_VALUE_ONLY.test(signal.title.trim())) return false
  return true
}
