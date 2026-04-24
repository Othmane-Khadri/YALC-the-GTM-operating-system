import { join } from 'node:path'
import { homedir } from 'node:os'

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
