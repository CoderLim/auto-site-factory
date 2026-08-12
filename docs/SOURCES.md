# Layer 1 Source Registry

This document defines the concrete starter sources used by Layer 1. The runtime configuration lives in [`config/source-targets.json`](../config/source-targets.json).

The registry deliberately separates two source roles:

- **Discovery**: broad sources that can reveal products, models, games, tools, or entities we were not already tracking.
- **Tracking**: sources attached to a known ecosystem that can surface new releases, features, characters, items, maps, or events earlier than broad search sources.

`sourceRole` is descriptive metadata only. Layer 1 does not score opportunities.

## Starter registry

| Target | Role | Scope | Default | Credential / access |
| --- | --- | --- | --- | --- |
| Hugging Face New Models | Discovery | AI models | Enabled | Public Hub API |
| Hugging Face New Spaces | Discovery | AI tools/apps | Enabled | Public Hub API |
| ComfyUI Releases | Tracking | AI tooling | Enabled | Public GitHub Releases API |
| Claude Code Releases | Tracking | AI tooling | Enabled | Public GitHub Releases API |
| OpenAI Codex Releases | Tracking | AI tooling | Enabled | Public GitHub Releases API |
| Grow a Garden Wiki | Tracking | Roblox game entities | Enabled | Public MediaWiki API |
| Blox Fruits Wiki | Tracking | Roblox game entities | Enabled | Public MediaWiki API |
| Roblox Wiki | Discovery | Roblox ecosystem | Enabled | Public MediaWiki API |
| Futurepedia Sitemap | Discovery | AI tools | Enabled | Public sitemap |
| Toolify Sitemap | Discovery | AI tools | Enabled | Public sitemap |
| r/LocalLLaMA | Discovery | AI | Disabled | Reddit API credential |
| r/roblox | Discovery | Roblox | Disabled | Reddit API credential |
| r/Steam | Discovery | Steam ecosystem | Disabled | Reddit API credential |
| r/SideProject | Discovery | software/tools | Disabled | Reddit API credential |
| OpenAI YouTube | Tracking | AI | Disabled | YouTube Data API key |
| Hugging Face YouTube | Tracking | AI | Disabled | YouTube Data API key |
| Valve YouTube | Tracking | Steam/games | Disabled | YouTube Data API key |
| OpenAI on X | Tracking | AI | Disabled | X API bearer token |
| Anthropic on X | Tracking | AI | Disabled | X API bearer token |
| Hugging Face on X | Tracking | AI | Disabled | X API bearer token |
| Roblox on X | Tracking | Roblox | Disabled | X API bearer token |
| Roblox RTC on X | Discovery | Roblox | Disabled | X API bearer token |
| Hugging Face Discord announcements relay | Tracking | AI | Disabled | Relay channel + Discord bot |
| Grow a Garden Discord announcements relay | Tracking | game entities | Disabled | Relay channel + Discord bot |

Public sources are enabled so a fresh installation can collect real signals without social-network credentials. Credentialed sources stay disabled until the corresponding environment variable and access are configured.

## Why `official_api` is not hard-coded to Steam

`official_api` is a generic structured-source adapter. The initial real targets use it for Hugging Face and GitHub Releases because those endpoints expose useful, machine-readable creation/release data.

Steam is currently covered by `r/Steam` and Valve YouTube rather than pretending the generic adapter is a Steam new-release feed. A dedicated Steam adapter should only be added when we choose a stable, policy-compliant endpoint that actually matches the discovery goal.

Roblox is similar: broad unknown-game discovery is currently handled by Roblox community/wiki/social sources. Once a specific Roblox experience becomes a tracked topic, its official APIs, wiki, Discord, and other first-party sources can be added as tracking targets.

## YouTube configuration

YouTube targets can now use a readable `handle` instead of a numeric channel ID:

```json
{
  "sourceType": "youtube",
  "config": {
    "handle": "@OpenAI",
    "apiKeyEnv": "YOUTUBE_API_KEY"
  }
}
```

The collector resolves the handle through `channels.list`, reads the channel uploads playlist, then polls `playlistItems.list`. This avoids requiring maintainers to look up and hard-code channel IDs.

## X configuration

X targets can use a readable username:

```json
{
  "sourceType": "x",
  "config": {
    "username": "AnthropicAI",
    "bearerTokenEnv": "X_BEARER_TOKEN"
  }
}
```

The collector resolves the numeric user ID once and stores it in the target cursor. Later runs reuse that resolved ID.

## Sitemap behavior

The sitemap collector supports both `<urlset>` and `<sitemapindex>` documents. It recursively follows child sitemaps within configured limits.

Important safeguards:

- `baselineOnFirstRun: true` records the current sitemap without treating every historical URL as a new signal.
- `maxNewUrls` limits processing per run.
- Unprocessed new URLs remain outside `seenUrls`, so they can be picked up on a later run instead of being silently lost.
- `urlIncludes` / `urlExcludes` can reduce irrelevant sections or language duplicates.

## Discord: relay, not a self-bot

The registry contains two real upstream Discord communities, but the targets are intentionally disabled and do not contain fake channel IDs.

The gateway only consumes channels that the configured bot is legitimately allowed to read. Do **not** use a Discord user token or self-bot to scrape servers.

Recommended setup:

1. Create a small Discord server you control, for example `Signal Relay`.
2. Where an upstream server exposes an announcement channel that supports following, follow/crosspost it into a channel in your relay server. Otherwise only use direct bot access when the upstream server explicitly permits/invites the bot.
3. Invite the factory bot to your relay server.
4. Add the relay `guildId` and `channelId` to the corresponding target.
5. Change `enabled` to `true`, run `npm run targets:sync`, then run `npm run discord`.

Example completed target:

```json
{
  "id": "discord-huggingface-relay",
  "sourceType": "discord",
  "enabled": true,
  "config": {
    "upstreamUrl": "https://hf.co/join/discord",
    "guildId": "YOUR_RELAY_GUILD_ID",
    "channelId": "YOUR_RELAY_CHANNEL_ID",
    "botTokenEnv": "DISCORD_BOT_TOKEN"
  }
}
```

## Enabling credentialed sources

Fill the environment variable in `.env`, then flip the corresponding target to `enabled: true`:

```bash
npm run targets:sync
npm run worker:once
```

Relevant variables:

```text
REDDIT_ACCESS_TOKEN
REDDIT_USER_AGENT
YOUTUBE_API_KEY
X_BEARER_TOKEN
DISCORD_BOT_TOKEN
```

For the first production trial, keep the public sources enabled, inspect at least one full day of `raw_signals`, `entity_mentions`, and `candidates`, then tune extraction and add more focused tracking targets based on what the system actually discovers.
