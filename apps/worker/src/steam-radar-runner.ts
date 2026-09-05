import { Database, SteamRepository } from "@factory/database"
import { promoteSteamRadarCandidates } from "./steam-radar.js"

const db = new Database()
const repository = new SteamRepository(db)

try {
  await promoteSteamRadarCandidates(db, repository)
} finally {
  await db.close()
}
