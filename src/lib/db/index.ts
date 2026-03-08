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

// Create FTS5 virtual table + sync triggers for knowledge search (idempotent)
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

  // Sync triggers — keep FTS5 in sync with knowledge_items
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_insert
    AFTER INSERT ON knowledge_items BEGIN
      INSERT INTO knowledge_fts(item_id, title, extracted_text)
      VALUES (new.id, new.title, new.extracted_text);
    END
  `)
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_delete
    AFTER DELETE ON knowledge_items BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, item_id, title, extracted_text)
      VALUES ('delete', old.id, old.title, old.extracted_text);
    END
  `)
  await client.execute(`
    CREATE TRIGGER IF NOT EXISTS knowledge_fts_update
    AFTER UPDATE ON knowledge_items BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, item_id, title, extracted_text)
      VALUES ('delete', old.id, old.title, old.extracted_text);
      INSERT INTO knowledge_fts(item_id, title, extracted_text)
      VALUES (new.id, new.title, new.extracted_text);
    END
  `)

  // Backfill: index any docs uploaded before triggers existed
  await client.execute(`
    INSERT OR IGNORE INTO knowledge_fts(item_id, title, extracted_text)
    SELECT id, title, extracted_text FROM knowledge_items
  `)
}

// Initialize FTS (non-blocking, fire-and-forget at module load)
initFts().catch(() => {
  // Table may already exist or knowledge_items not yet created — safe to ignore
})

export type DB = typeof db
