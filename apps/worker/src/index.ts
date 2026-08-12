import { runDiscoveryOnce } from "./run-once.js"
import type { SignalSourceType } from "@factory/shared"

const once = process.argv.includes("--once")
const sourceArg = process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1]
const sourceType = sourceArg as SignalSourceType | undefined
const hours = Number(process.env.DISCOVERY_INTERVAL_HOURS ?? "5")
const intervalMs = Math.max(1, hours) * 60 * 60 * 1000

await runDiscoveryOnce(sourceType)

if (!once) {
  console.log(`[worker] scheduling discovery every ${hours} hour(s)`)
  setInterval(() => {
    void runDiscoveryOnce(sourceType).catch((error) => console.error("[worker] scheduled run failed", error))
  }, intervalMs)
}
