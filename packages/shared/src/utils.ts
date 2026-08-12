import { createHash, randomUUID } from "node:crypto"

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export function signalFingerprint(
  sourceType: string,
  sourceTargetId: string,
  externalId: string
): string {
  return sha256(`${sourceType}|${sourceTargetId}|${externalId}`)
}

export function getString(
  value: Record<string, unknown>,
  key: string,
  fallback = ""
): string {
  const candidate = value[key]
  return typeof candidate === "string" ? candidate : fallback
}

export function getNumber(
  value: Record<string, unknown>,
  key: string,
  fallback: number
): number {
  const candidate = value[key]
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : fallback
}

export function getBoolean(
  value: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const candidate = value[key]
  return typeof candidate === "boolean" ? candidate : fallback
}

export function resolveEnvName(
  config: Record<string, unknown>,
  key: string
): string | undefined {
  const envName = getString(config, key)
  if (!envName) return undefined
  return process.env[envName]
}

export function getPath(input: unknown, path: string): unknown {
  if (!path) return input
  return path.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, input)
}
