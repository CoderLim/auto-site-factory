import {
  DiscoveryRepository,
  KeywordRepository,
  type Database,
  type SteamGameSummary,
  type SteamRepository
} from "@factory/database"
import {
  generateKeywordCandidate,
  normalizeEntityName,
  scoreSteamOpportunity,
  shouldPromoteSteamOpportunity
} from "@factory/discovery"
import { newId, type RawSignal, type StoredSignal } from "@factory/shared"

const RADAR_TARGET_ID = "steam-opportunity-radar"
const RADAR_SCOPE = "steam-games"
const MAX_PROMOTIONS_PER_RUN = 100

function uniqueGames(groups: SteamGameSummary[][]): SteamGameSummary[] {
  const byAppid = new Map<number, SteamGameSummary>()
  for (const group of groups) {
    for (const game of group) byAppid.set(game.appid, game)
  }
  return [...byAppid.values()]
}

function evidence(game: SteamGameSummary, score: number, priority: string, reasons: string[]): string {
  return [
    `Steam opportunity ${priority} score=${score}`,
    game.followersCurrent != null ? `followers=${game.followersCurrent}` : undefined,
    game.followers7dDelta != null ? `followers7dDelta=${game.followers7dDelta}` : undefined,
    game.ccuCurrent != null ? `ccu=${game.ccuCurrent}` : undefined,
    game.releaseDate ? `release=${game.releaseDate}` : undefined,
    game.hasPlaytest ? "playtest" : undefined,
    game.hasDemo ? "demo" : undefined,
    reasons.join(",")
  ].filter(Boolean).join(" · ")
}

export async function promoteSteamRadarCandidates(db: Database, steamRepository: SteamRepository): Promise<number> {
  const discoveryRepository = new DiscoveryRepository(db)
  const keywordRepository = new KeywordRepository(db)
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  await discoveryRepository.upsertSourceTarget({
    id: RADAR_TARGET_ID,
    sourceType: "official_api",
    name: "Steam Opportunity Radar",
    scope: RADAR_SCOPE,
    enabled: false,
    config: { synthetic: true }
  })

  const games = uniqueGames(await Promise.all([
    steamRepository.listGames({ since, sort: "recent", limit: 500 }),
    steamRepository.listGames({ since, sort: "followers", limit: 500 }),
    steamRepository.listGames({ since, sort: "follower_growth", limit: 500 }),
    steamRepository.listGames({ since, sort: "ccu", limit: 500 })
  ]))

  const ranked = games
    .map((game) => ({
      game,
      result: scoreSteamOpportunity({
        followersCurrent: game.followersCurrent,
        followers7dDelta: game.followers7dDelta,
        followers7dGrowthPct: game.followers7dGrowthPct,
        storeStatus: game.storeStatus,
        releaseDate: game.releaseDate,
        hasDemo: game.hasDemo,
        hasPlaytest: game.hasPlaytest,
        ccuCurrent: game.ccuCurrent,
        ccu24hGrowthPct: game.ccu24hGrowthPct,
        opportunityReason: game.opportunityReason
      }, now)
    }))
    .filter(({ result }) => shouldPromoteSteamOpportunity(result))
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, MAX_PROMOTIONS_PER_RUN)

  let promoted = 0
  for (const { game, result } of ranked) {
    const discoveredAt = game.opportunityAt ? new Date(game.opportunityAt) : now
    const signal: RawSignal = {
      id: newId("sig"),
      sourceType: "official_api",
      sourceTargetId: RADAR_TARGET_ID,
      externalId: `${game.appid}:${result.priority}`,
      title: game.name,
      content: evidence(game, result.score, result.priority, result.reasons),
      url: game.storeUrl ?? `https://store.steampowered.com/app/${game.appid}/`,
      publishedAt: discoveredAt,
      discoveredAt,
      metadata: {
        appid: game.appid,
        priority: result.priority,
        opportunityScore: result.score,
        opportunityReasons: result.reasons,
        opportunityReason: game.opportunityReason,
        followersCurrent: game.followersCurrent,
        followers7dDelta: game.followers7dDelta,
        followers7dGrowthPct: game.followers7dGrowthPct,
        ccuCurrent: game.ccuCurrent,
        releaseDate: game.releaseDate,
        hasPlaytest: game.hasPlaytest,
        hasDemo: game.hasDemo
      },
      fingerprint: `steam-opportunity:${game.appid}:${result.priority}`
    }

    const inserted = await discoveryRepository.insertSignals([signal])
    if (inserted === 0) continue

    const storedSignal: StoredSignal = { ...signal, scope: RADAR_SCOPE }
    const entity = await discoveryRepository.registerEntityMention(
      storedSignal,
      {
        name: game.name,
        type: "GAME",
        confidence: 1,
        evidence: signal.content
      },
      normalizeEntityName(game.name)
    )
    await discoveryRepository.markSignalProcessed(signal.id)

    const keyword = generateKeywordCandidate({
      entityId: entity.entityId,
      name: game.name,
      entityType: "GAME",
      scope: RADAR_SCOPE,
      firstSeenAt: discoveredAt.toISOString(),
      lastSeenAt: discoveredAt.toISOString()
    })
    if (keyword) await keywordRepository.saveGenerated([keyword])

    promoted += 1
    console.log(
      `[steam-radar] priority=${result.priority} score=${result.score}` +
      ` appid=${game.appid} followers=${game.followersCurrent ?? 0}` +
      ` reason=${game.opportunityReason ?? "unknown"} name=${game.name}`
    )
  }

  console.log(`[steam-radar] scanned=${games.length} eligible=${ranked.length} promoted=${promoted}`)
  return promoted
}
