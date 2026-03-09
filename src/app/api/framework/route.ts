import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { frameworks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { GTMFramework } from '@/lib/framework/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const row = await db.query.frameworks.findFirst({
      where: (t, { eq }) => eq(t.userId, 'default'),
    })

    if (!row) {
      return Response.json({ framework: null })
    }

    return Response.json({
      framework: row.data,
      onboardingComplete: row.onboardingComplete,
      onboardingStep: row.onboardingStep,
    })
  } catch {
    return Response.json({ framework: null })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { framework } = await req.json() as { framework: Partial<GTMFramework> }

    if (!framework || typeof framework !== 'object' || Array.isArray(framework)) {
      return Response.json({ error: 'Invalid framework data' }, { status: 400 })
    }

    framework.lastUpdated = new Date().toISOString()

    const existing = await db.query.frameworks.findFirst({
      where: (t, { eq }) => eq(t.userId, 'default'),
    })

    if (existing) {
      await db.update(frameworks)
        .set({
          data: framework as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(eq(frameworks.userId, 'default'))
    } else {
      await db.insert(frameworks).values({
        userId: 'default',
        data: framework as unknown as Record<string, unknown>,
      })
    }

    return Response.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save framework'
    return Response.json({ error: message }, { status: 500 })
  }
}
