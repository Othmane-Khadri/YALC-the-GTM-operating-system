import { db } from '@/lib/db'
import { knowledgeItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.delete(knowledgeItems).where(eq(knowledgeItems.id, id))
  return Response.json({ success: true })
}
