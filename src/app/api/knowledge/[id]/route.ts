import { db } from '@/lib/db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.delete(knowledgeItems).where(eq(knowledgeItems.id, id))
    return Response.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete knowledge item'
    return Response.json({ error: message }, { status: 500 })
  }
}
