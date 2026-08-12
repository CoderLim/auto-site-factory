import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Database } from "./client.js"

const migrationUrl = new URL("../../../migrations/001_discovery.sql", import.meta.url)
const sql = await readFile(fileURLToPath(migrationUrl), "utf8")
const db = new Database()

try {
  await db.query(sql)
  console.log("Discovery schema migrated")
} finally {
  await db.close()
}
