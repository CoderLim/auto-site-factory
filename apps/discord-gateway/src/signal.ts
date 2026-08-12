import { newId, signalFingerprint, type RawSignal, type SourceTarget } from "@factory/shared"

interface MessageCreate {
  id: string
  channel_id: string
  content?: string
  timestamp?: string
  author?: { id?: string; username?: string }
  embeds?: Array<{ title?: string; description?: string; url?: string }>
}

export function makeDiscordSignal(target: SourceTarget, message: MessageCreate): RawSignal {
  const embed = message.embeds?.[0]
  const title = embed?.title ?? message.content?.split("\n")[0]?.slice(0, 300)
  const content = [message.content, embed?.description].filter(Boolean).join("\n\n")
  return {
    id: newId("sig"),
    sourceType: "discord",
    sourceTargetId: target.id,
    externalId: message.id,
    title,
    content,
    url: embed?.url,
    author: message.author?.username ?? message.author?.id,
    publishedAt: message.timestamp ? new Date(message.timestamp) : undefined,
    discoveredAt: new Date(),
    metadata: { channelId: message.channel_id },
    fingerprint: signalFingerprint("discord", target.id, message.id)
  }
}
