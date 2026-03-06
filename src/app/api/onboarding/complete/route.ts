import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { frameworks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { GTMFramework } from '@/lib/framework/types'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { framework } = await req.json() as { framework: GTMFramework }

  try {
    // Mark as complete
    framework.onboardingComplete = true
    framework.lastUpdated = new Date().toISOString()

    // Check if framework already exists for default user
    const existing = await db.query.frameworks.findFirst({
      where: (t, { eq }) => eq(t.userId, 'default'),
    })

    if (existing) {
      await db.update(frameworks)
        .set({
          data: framework as unknown as Record<string, unknown>,
          onboardingComplete: true,
          onboardingStep: 5,
          updatedAt: new Date(),
        })
        .where(eq(frameworks.userId, 'default'))
    } else {
      await db.insert(frameworks).values({
        userId: 'default',
        data: framework as unknown as Record<string, unknown>,
        onboardingComplete: true,
        onboardingStep: 5,
      })
    }

    return Response.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save framework'
    return Response.json({ error: message }, { status: 500 })
  }
}
