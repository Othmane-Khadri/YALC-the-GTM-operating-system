import { join } from 'node:path'
import { homedir } from 'node:os'
import { config as loadEnv } from 'dotenv'

// Load .env.local so DATABASE_URL stays in sync with the runtime CLI, which
// also reads from .env.local. Without this, drizzle-kit push/generate target
// ~/.gtm-os/gtm-os.db while the CLI targets ./gtm-os.db, and the tables in
// the two diverge silently.
loadEnv({ path: '.env.local' })

/** @type {import('drizzle-kit').Config} */
export default {
  schema: ['./src/lib/db/schema.ts', './src/lib/memory/schema.ts'],
  out: './src/lib/db/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? `file:${join(homedir(), '.gtm-os', 'gtm-os.db')}`,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
}
