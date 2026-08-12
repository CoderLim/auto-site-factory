import { runDiscoveryOnce } from "./run-once.js"

const once = process.argv.includes("--once")
const hours = Number(process.env.DISCOVERY_INTERVAL_HOURS ?? "5")
const intervalMs = Math.max(1, hours) * 60 * 60 * 1000

await runDiscoveryOnce()

if (!once) {
  console.log(`[worker] scheduling discovery every ${hours} hour(s)`)
  setInterval(() => {
    void runDiscoveryOnce().catch((error) => console.error("[worker] scheduled run failed", error))
  }, intervalMs)
}
