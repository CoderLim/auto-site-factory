import { sha256, type Collector } from "@factory/shared"
import { configNumber, configString, configStringArray, makeSignal, requireConfigString } from "./base.js"

type TwitchStream = {
  id?: string
  user_id?: string
  user_login?: string
  user_name?: string
  game_id?: string
  game_name?: string
  type?: string
  title?: string
  viewer_count?: number
  started_at?: string
  language?: string
  tags?: string[]
}

function envValue(config: Record<string, unknown>, key: string): string | undefined {
  const envName = configString(config, key)
  if (!envName) return undefined
  const value = process.env[envName]
  return value?.trim() || undefined
}

async function getAppToken(
  config: Record<string, unknown>,
  fetcher: typeof fetch
): Promise<{ clientId: string; token: string }> {
  const clientIdEnv = requireConfigString(config, "clientIdEnv")
  const clientId = process.env[clientIdEnv]
  if (!clientId) throw new Error(`Environment variable ${clientIdEnv} is required`)

  const configuredToken = envValue(config, "accessTokenEnv")
  if (configuredToken) return { clientId, token: configuredToken }

  const clientSecretEnv = requireConfigString(config, "clientSecretEnv")
  const clientSecret = process.env[clientSecretEnv]
  if (!clientSecret) throw new Error(`Environment variable ${clientSecretEnv} is required`)

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials"
  })
  const response = await fetcher(`https://id.twitch.tv/oauth2/token?${params}`, { method: "POST" })
  if (!response.ok) throw new Error(`Twitch OAuth ${response.status}`)
  const payload = await response.json() as { access_token?: string }
  if (!payload.access_token) throw new Error("Twitch OAuth response missing access_token")
  return { clientId, token: payload.access_token }
}

function configuredLogins(config: Record<string, unknown>): string[] {
  const logins = configStringArray(config, "logins")
  const login = configString(config, "login")
  return [...new Set([...logins, ...(login ? [login] : [])].map((value) => value.toLowerCase()))].slice(0, 100)
}

function cursorSeenKeys(cursor: Record<string, unknown> | undefined): string[] {
  const value = cursor?.seenKeys
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

export const twitchCollector: Collector = {
  type: "twitch",
  async collect(target, cursor, context) {
    const logins = configuredLogins(target.config)
    if (logins.length === 0) throw new Error("Twitch target requires login or logins")

    const { clientId, token } = await getAppToken(target.config, context.fetch)
    const params = new URLSearchParams()
    for (const login of logins) params.append("user_login", login)

    const response = await context.fetch(`https://api.twitch.tv/helix/streams?${params}`, {
      headers: {
        "Client-Id": clientId,
        "Authorization": `Bearer ${token}`
      }
    })
    if (!response.ok) throw new Error(`Twitch streams ${response.status}`)
    const payload = await response.json() as { data?: TwitchStream[] }
    const streams = payload.data ?? []

    const previousSeenKeys = cursorSeenKeys(cursor)
    const seen = new Set(previousSeenKeys)
    const minViewers = Math.max(0, configNumber(target.config, "minViewers", 0))

    const entries = streams.flatMap((stream) => {
      if (!stream.id || !stream.title || !stream.user_login) return []
      if ((stream.viewer_count ?? 0) < minViewers) return []
      const titleHash = sha256(stream.title.trim()).slice(0, 16)
      const key = `${stream.id}:${titleHash}`
      return [{ stream, key }]
    })

    const signals = entries
      .filter(({ key }) => !seen.has(key))
      .map(({ stream, key }) => makeSignal("twitch", target, key, {
        title: stream.title,
        author: stream.user_name ?? stream.user_login,
        url: `https://www.twitch.tv/${stream.user_login}`,
        publishedAt: stream.started_at ? new Date(stream.started_at) : undefined,
        discoveredAt: context.now,
        metadata: {
          streamId: stream.id,
          userId: stream.user_id,
          login: stream.user_login,
          gameId: stream.game_id,
          gameName: stream.game_name,
          viewers: stream.viewer_count ?? 0,
          language: stream.language,
          tags: stream.tags ?? []
        }
      }))

    const historyLimit = Math.min(2000, Math.max(100, configNumber(target.config, "historyLimit", 500)))
    return {
      signals,
      nextCursor: {
        seenKeys: [...entries.map(({ key }) => key), ...previousSeenKeys].slice(0, historyLimit)
      }
    }
  }
}
