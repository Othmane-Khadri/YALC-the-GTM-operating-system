import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

/**
 * Resolve APIFY_TOKEN from env var first, then fall back to the encrypted vault.
 * Throws if neither source has a token.
 */
export async function getApifyToken(): Promise<string> {
  // 1. Prefer env var (always available on server, no DB query)
  if (process.env.APIFY_TOKEN) return process.env.APIFY_TOKEN

  // 2. Fall back to encrypted vault (user added key via API Keys page)
  try {
    const [conn] = await db.select().from(apiConnections)
      .where(eq(apiConnections.provider, 'apify'))
      .limit(1)
    if (conn?.encryptedKey) {
      return decrypt(conn.encryptedKey)
    }
  } catch {
    // vault query failed — fall through
  }

  throw new Error(
    'APIFY_TOKEN not found. Set it in .env.local or add it via the API Keys page.'
  )
}
