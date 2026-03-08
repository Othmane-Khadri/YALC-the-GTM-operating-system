import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema'

const DATABASE_URL = process.env.DATABASE_URL ?? 'file:./gtm-os.db'

const client = createClient({
  url: DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

export { client as rawClient }
export const db = drizzle(client, { schema })

// Create FTS5 virtual table for knowledge search (idempotent)
// Run once at startup — safe to call multiple times
async function initFts() {
  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      item_id UNINDEXED,
      title,
      extracted_text,
      content='knowledge_items',
      content_rowid='rowid'
    )
  `)
}

// Initialize FTS (non-blocking, fire-and-forget at module load)
initFts().catch(() => {
  // Table may already exist or knowledge_items not yet created — safe to ignore
})

export type DB = typeof db
