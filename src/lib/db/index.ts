import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import * as schema from './schema'

const GTM_OS_DIR = join(homedir(), '.gtm-os')
const DEFAULT_DB_PATH = join(GTM_OS_DIR, 'gtm-os.db')
const DATABASE_URL = process.env.DATABASE_URL ?? `file:${DEFAULT_DB_PATH}`

// libsql needs the parent directory of the DB file to exist before it
// can create the file. On a fresh install ~/.gtm-os doesn't exist yet.
if (DATABASE_URL.startsWith('file:')) {
  const path = DATABASE_URL.slice('file:'.length)
  if (!path.startsWith(':')) mkdirSync(dirname(path), { recursive: true })
}

const client = createClient({
  url: DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

// Enable foreign key enforcement before any queries
client.execute('PRAGMA foreign_keys = ON')
client.execute('PRAGMA journal_mode = WAL')

export { client as rawClient }
export const db = drizzle(client, { schema })

// Create standalone FTS5 virtual table + sync triggers for knowledge search (idempotent)
async function initFts() {
  // Skip on a fresh DB where migrations haven't run yet — the triggers below
  // reference knowledge_items, which SQLite requires to exist at CREATE TRIGGER time.
  const tableCheck = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_items' LIMIT 1"
  )
  if (tableCheck.rows.length === 0) return

  await client.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      item_id UNINDEXED,
      title,
      extracted_text
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

  // Backfill: index any docs not yet in FTS
  await client.execute(`
    INSERT OR IGNORE INTO knowledge_fts(item_id, title, extracted_text)
    SELECT id, title, extracted_text FROM knowledge_items
    WHERE id NOT IN (SELECT item_id FROM knowledge_fts)
  `)
}

// Initialize FTS (non-blocking, fire-and-forget at module load)
initFts().catch((err) => {
  console.error('FTS initialization failed:', err)
})

export type DB = typeof db
