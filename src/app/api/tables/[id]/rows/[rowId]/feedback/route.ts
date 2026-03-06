import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resultRows } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getCollector } from '@/lib/signals/collector'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const { id: resultSetId, rowId } = await params
  const { feedback, annotation, tags } = await req.json() as {
    feedback: 'approved' | 'rejected' | 'flagged' | null
    annotation?: string
    tags?: string[]
  }

  const updateData: Record<string, unknown> = {
    feedback,
    updatedAt: new Date(),
  }

  if (annotation !== undefined) {
    updateData.annotation = annotation
  }

  if (tags !== undefined) {
    updateData.tags = tags
  }

  await db.update(resultRows)
    .set(updateData)
    .where(eq(resultRows.id, rowId))

  // Emit RLHF feedback signal
  if (feedback) {
    await getCollector().emit({
      type: 'rlhf_feedback',
      category: 'qualification',
      data: { rowId, feedback, annotation, tags },
      resultSetId,
    })
  }

  return Response.json({ updated: true })
}
