import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params

  await db.delete(apiConnections).where(eq(apiConnections.provider, provider))

  return Response.json({ deleted: true })
}

// POST = test connection (validate key format for now)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params

  const [connection] = await db.select().from(apiConnections)
    .where(eq(apiConnections.provider, provider))
    .limit(1)

  if (!connection) {
    return Response.json({ valid: false, error: 'No key found for this provider' }, { status: 404 })
  }

  // Basic format validation (real health checks come later)
  const isValid = connection.encryptedKey && connection.encryptedKey.includes(':')

  await db.update(apiConnections)
    .set({ lastTestedAt: new Date(), status: isValid ? 'active' : 'invalid' })
    .where(eq(apiConnections.provider, provider))

  return Response.json({ valid: isValid, provider, status: isValid ? 'active' : 'invalid' })
}
