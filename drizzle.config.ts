import type { Config } from 'drizzle-kit'

export default {
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./gtm-os.db',
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config
