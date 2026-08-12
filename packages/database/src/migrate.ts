import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Database } from "./client.js"

const migrationsUrl = new URL("../../../migrations/", import.meta.url)
const migrationsDir = fileURLToPath(migrationsUrl)
const files = (await readdir(migrationsDir))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort()

const db = new Database()
try {
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8")
    await db.query(sql)
    console.log(`[migrate] applied ${file}`)
  }
} finally {
  await db.close()
}
