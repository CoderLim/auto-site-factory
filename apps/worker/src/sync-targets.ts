import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Database, DiscoveryRepository } from "@factory/database"
import type { SourceTarget } from "@factory/shared"

const file = resolve(process.env.SOURCE_TARGETS_FILE ?? "config/source-targets.json")
const targets = JSON.parse(await readFile(file, "utf8")) as SourceTarget[]
const db = new Database()
const repository = new DiscoveryRepository(db)

try {
  for (const target of targets) {
    await repository.upsertSourceTarget(target)
    console.log(`[targets] synced ${target.id} enabled=${target.enabled}`)
  }
} finally {
  await db.close()
}
