import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'

export async function GET() {
  const connections = await db.select({
    provider: apiConnections.provider,
    status: apiConnections.status,
    lastTestedAt: apiConnections.lastTestedAt,
    createdAt: apiConnections.createdAt,
  }).from(apiConnections)

  return Response.json({ connections })
}

export async function POST(req: NextRequest) {
  const { provider, key } = await req.json() as {
    provider: string
    key: string
  }

  const encryptedKey = encrypt(key)

  // Upsert: try update first, then insert
  const existing = await db.select().from(apiConnections)
    .where(eq(apiConnections.provider, provider))
    .limit(1)

  if (existing.length > 0) {
    await db.update(apiConnections)
      .set({
        encryptedKey,
        status: 'active',
        lastTestedAt: new Date(),
      })
      .where(eq(apiConnections.provider, provider))
  } else {
    await db.insert(apiConnections).values({
      provider,
      encryptedKey,
      status: 'active',
      lastTestedAt: new Date(),
    })
  }

  return Response.json({ saved: true, provider, status: 'active' })
}
