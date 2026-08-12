import {
  newId,
  signalFingerprint,
  type RawSignal,
  type SignalSourceType,
  type SourceTarget
} from "@factory/shared"

export function makeSignal(
  sourceType: SignalSourceType,
  target: SourceTarget,
  externalId: string,
  input: Omit<RawSignal, "id" | "sourceType" | "sourceTargetId" | "externalId" | "fingerprint">
): RawSignal {
  return {
    id: newId("sig"),
    sourceType,
    sourceTargetId: target.id,
    externalId,
    fingerprint: signalFingerprint(sourceType, target.id, externalId),
    ...input
  }
}

export function requireConfigString(
  config: Record<string, unknown>,
  key: string
): string {
  const value = config[key]
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required config: ${key}`)
  }
  return value.trim()
}

export function configString(
  config: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const value = config[key]
  return typeof value === "string" ? value : fallback
}

export function configNumber(
  config: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const value = config[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function configBoolean(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = config[key]
  return typeof value === "boolean" ? value : fallback
}

export function configStringArray(
  config: Record<string, unknown>,
  key: string,
  fallback: string[] = []
): string[] {
  const value = config[key]
  if (typeof value === "string" && value.trim()) return [value.trim()]
  if (!Array.isArray(value)) return fallback
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

export function envFromConfig(
  config: Record<string, unknown>,
  key: string
): string {
  const envName = requireConfigString(config, key)
  const value = process.env[envName]
  if (!value) throw new Error(`Environment variable ${envName} is required`)
  return value
}
