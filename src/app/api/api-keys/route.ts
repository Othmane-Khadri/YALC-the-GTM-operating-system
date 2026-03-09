import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { apiConnections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt } from '@/lib/crypto'
import { PROVIDER_LABELS, type ApiProvider } from '@/lib/ai/types'

const VALID_PROVIDERS = new Set(Object.keys(PROVIDER_LABELS))

export async function GET() {
  try {
    const connections = await db.select({
      provider: apiConnections.provider,
      status: apiConnections.status,
      lastTestedAt: apiConnections.lastTestedAt,
      createdAt: apiConnections.createdAt,
    }).from(apiConnections)

    return Response.json({ connections })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch API keys'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { provider, key } = await req.json() as {
    provider: string
    key: string
  }

  if (!provider || !VALID_PROVIDERS.has(provider)) {
    return Response.json(
      { error: `Invalid provider. Must be one of: ${[...VALID_PROVIDERS].join(', ')}` },
      { status: 400 }
    )
  }
  if (!key || typeof key !== 'string' || key.length > 500) {
    return Response.json({ error: 'Invalid API key' }, { status: 400 })
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
