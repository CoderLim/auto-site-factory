import WebSocket from "ws"
import { Database, DiscoveryRepository } from "@factory/database"
import { makeDiscordSignal } from "./signal.js"
import type { SourceTarget } from "@factory/shared"

interface GatewayPayload {
  op: number
  d?: unknown
  s?: number | null
  t?: string | null
}

interface HelloPayload {
  heartbeat_interval: number
}

interface MessageCreate {
  id: string
  guild_id?: string
  channel_id: string
  content?: string
  timestamp?: string
  author?: { id?: string; username?: string }
  embeds?: Array<{ title?: string; description?: string; url?: string }>
}

const db = new Database()
const repository = new DiscoveryRepository(db)
const targets = await repository.listEnabledTargets("discord")
if (targets.length === 0) {
  console.log("[discord] no enabled discord targets")
  await db.close()
  process.exit(0)
}

const envNames = [...new Set(targets.map((target) => String(target.config.botTokenEnv ?? "DISCORD_BOT_TOKEN")))]
if (envNames.length !== 1) {
  throw new Error("All enabled Discord targets must currently use the same bot token")
}
const token = process.env[envNames[0]]
if (!token) throw new Error(`Environment variable ${envNames[0]} is required`)

const targetByChannel = new Map<string, SourceTarget>()
for (const target of targets) {
  const channelId = String(target.config.channelId ?? "")
  if (channelId) targetByChannel.set(channelId, target)
}

let sequence: number | null = null
let heartbeat: NodeJS.Timeout | undefined
const ws = new WebSocket("wss://gateway.discord.gg/?v=10&encoding=json")

ws.on("message", async (raw) => {
  const payload = JSON.parse(raw.toString()) as GatewayPayload
  if (typeof payload.s === "number") sequence = payload.s

  if (payload.op === 10) {
    const hello = payload.d as HelloPayload
    heartbeat = setInterval(() => ws.send(JSON.stringify({ op: 1, d: sequence })), hello.heartbeat_interval)
    ws.send(JSON.stringify({
      op: 2,
      d: {
        token,
        intents: (1 << 0) | (1 << 9) | (1 << 15),
        properties: { os: process.platform, browser: "auto-site-factory", device: "auto-site-factory" }
      }
    }))
    return
  }

  if (payload.op === 0 && payload.t === "MESSAGE_CREATE") {
    const message = payload.d as MessageCreate
    const target = targetByChannel.get(message.channel_id)
    if (!target) return
    const configuredGuild = typeof target.config.guildId === "string" ? target.config.guildId : undefined
    if (configuredGuild && configuredGuild !== message.guild_id) return
    const signal = makeDiscordSignal(target, message)
    const inserted = await repository.insertSignals([signal])
    if (inserted) console.log(`[discord] captured ${target.name} message=${message.id}`)
  }
})

ws.on("close", async () => {
  if (heartbeat) clearInterval(heartbeat)
  await db.close()
})

ws.on("error", (error) => console.error("[discord] gateway error", error))
