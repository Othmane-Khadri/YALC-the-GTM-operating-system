import { db } from '@/lib/db'
import { frameworks } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export const runtime = 'nodejs'

export async function POST() {
  try {
    await db.delete(frameworks).where(eq(frameworks.userId, 'default'))
    return Response.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to reset'
    return Response.json({ error: message }, { status: 500 })
  }
}
