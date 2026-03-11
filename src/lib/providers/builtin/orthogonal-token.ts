import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto'

/**
 * Resolve ORTHOGONAL_API_KEY from env var first, then fall back to the encrypted vault.
 * Throws if neither source has a token.
 */
export async function getOrthogonalToken(): Promise<string> {
  // 1. Prefer env var (always available on server, no DB query)
  if (process.env.ORTHOGONAL_API_KEY) return process.env.ORTHOGONAL_API_KEY

  // 2. Fall back to encrypted vault (user added key via API Keys page)
  try {
    const [conn] = await db.select().from(apiConnections)
      .where(eq(apiConnections.provider, 'orthogonal'))
      .limit(1)
    if (conn?.encryptedKey) {
      return decrypt(conn.encryptedKey)
    }
  } catch {
    // vault query failed — fall through
  }

  throw new Error(
    'ORTHOGONAL_API_KEY not found. Set it in .env.local or add it via the API Keys page.'
  )
}
