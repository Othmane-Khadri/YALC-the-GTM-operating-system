import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resultSets, resultRows } from '@/lib/db/schema'
import { eq, asc } from 'drizzle-orm'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const [table] = await db.select().from(resultSets).where(eq(resultSets.id, id)).limit(1)

    if (!table) {
      return Response.json({ error: 'Table not found' }, { status: 404 })
    }

    const rows = await db.select().from(resultRows)
      .where(eq(resultRows.resultSetId, id))
      .orderBy(asc(resultRows.rowIndex))

    return Response.json({
      table: {
        id: table.id,
        name: table.name,
        workflowId: table.workflowId,
        columns: table.columnsDefinition,
        rowCount: table.rowCount,
        createdAt: table.createdAt,
      },
      rows: rows.map(r => ({
        id: r.id,
        rowIndex: r.rowIndex,
        data: r.data as Record<string, unknown>,
        feedback: r.feedback,
        tags: (r.tags as string[]) || [],
        annotation: r.annotation,
      })),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch table'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.delete(resultSets).where(eq(resultSets.id, id))
    return Response.json({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete table'
    return Response.json({ error: message }, { status: 500 })
  }
}
