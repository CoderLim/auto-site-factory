export type SteamOpportunityPriority = "P0" | "P1" | "P2" | "P3"

export type SteamOpportunityInput = {
  followersCurrent?: number
  followers7dDelta?: number
  followers7dGrowthPct?: number
  storeStatus: "unknown" | "coming_soon" | "released" | "unavailable"
  releaseDate?: string
  hasDemo: boolean
  hasPlaytest: boolean
  ccuCurrent?: number
  ccu24hGrowthPct?: number
  opportunityReason?: string
}

export type SteamOpportunityScore = {
  score: number
  priority: SteamOpportunityPriority
  reasons: string[]
}

function daysUntil(date: string | undefined, now: Date): number | undefined {
  if (!date) return undefined
  const target = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(target)) return undefined
  return Math.ceil((target - now.getTime()) / (24 * 60 * 60 * 1000))
}

export function scoreSteamOpportunity(input: SteamOpportunityInput, now = new Date()): SteamOpportunityScore {
  const reasons: string[] = []
  let score = 0
  const followers = input.followersCurrent ?? 0

  if (followers >= 100_000) { score += 45; reasons.push("followers_100k_plus") }
  else if (followers >= 50_000) { score += 35; reasons.push("followers_50k_plus") }
  else if (followers >= 20_000) { score += 25; reasons.push("followers_20k_plus") }
  else if (followers >= 5_000) { score += 15; reasons.push("followers_5k_plus") }
  else if (followers >= 1_000) { score += 8; reasons.push("followers_1k_plus") }

  const followerDelta = input.followers7dDelta ?? 0
  if (followerDelta >= 10_000) { score += 25; reasons.push("followers_7d_plus_10k") }
  else if (followerDelta >= 3_000) { score += 15; reasons.push("followers_7d_plus_3k") }
  else if (followerDelta >= 500) { score += 8; reasons.push("followers_7d_plus_500") }

  if ((input.followers7dGrowthPct ?? 0) >= 50) { score += 10; reasons.push("followers_7d_growth_50pct") }
  if (input.hasPlaytest) { score += 15; reasons.push("playtest_live") }
  if (input.hasDemo) { score += 5; reasons.push("demo_live") }

  if (input.storeStatus === "coming_soon") {
    const releaseInDays = daysUntil(input.releaseDate, now)
    if (releaseInDays != null && releaseInDays >= 0 && releaseInDays <= 14) {
      score += 15; reasons.push("release_within_14d")
    } else if (releaseInDays != null && releaseInDays <= 30) {
      score += 10; reasons.push("release_within_30d")
    } else if (releaseInDays != null && releaseInDays <= 90) {
      score += 5; reasons.push("release_within_90d")
    }
  }

  if (input.storeStatus === "released") {
    const ccu = input.ccuCurrent ?? 0
    if (ccu >= 5_000) { score += 25; reasons.push("ccu_5k_plus") }
    else if (ccu >= 1_000) { score += 15; reasons.push("ccu_1k_plus") }
    else if (ccu >= 200) { score += 8; reasons.push("ccu_200_plus") }
    if ((input.ccu24hGrowthPct ?? 0) >= 100) { score += 10; reasons.push("ccu_24h_doubled") }
  }

  if (input.opportunityReason === "follower_spike") { score += 15; reasons.push("follower_spike") }
  else if (input.opportunityReason === "ccu_spike") { score += 15; reasons.push("ccu_spike") }
  else if (input.opportunityReason === "new_app") { score += 5; reasons.push("new_app") }
  else if (input.opportunityReason === "high_followers") { score += 10; reasons.push("high_followers_first_sample") }

  score = Math.min(100, score)
  const priority: SteamOpportunityPriority = score >= 70 ? "P0" : score >= 50 ? "P1" : score >= 30 ? "P2" : "P3"
  return { score, priority, reasons }
}

export function shouldPromoteSteamOpportunity(result: SteamOpportunityScore): boolean {
  return result.priority === "P0" || result.priority === "P1"
}
