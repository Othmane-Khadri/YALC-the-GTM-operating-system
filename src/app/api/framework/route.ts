import { db } from '@/lib/db'

export const runtime = 'nodejs'

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
