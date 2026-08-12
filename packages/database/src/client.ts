import pg from "pg"

const { Pool } = pg

export class Database {
  readonly pool: pg.Pool

  constructor(connectionString = process.env.DATABASE_URL) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required")
    }
    this.pool = new Pool({ connectionString })
  }

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = []
  ): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(text, params)
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
