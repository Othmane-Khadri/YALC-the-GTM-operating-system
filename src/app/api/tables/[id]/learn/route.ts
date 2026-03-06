import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { resultSets, resultRows } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { extractLearnings } from '@/lib/execution/learning-extractor'
import type { ColumnDef } from '@/lib/ai/types'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Get table metadata
  const [table] = await db.select().from(resultSets).where(eq(resultSets.id, id)).limit(1)
  if (!table) {
    return Response.json({ error: 'Table not found' }, { status: 404 })
  }

  // Get all rows grouped by feedback
  const rows = await db.select().from(resultRows).where(eq(resultRows.resultSetId, id))

  const approved = rows.filter(r => r.feedback === 'approved').map(r => r.data as Record<string, unknown>)
  const rejected = rows.filter(r => r.feedback === 'rejected').map(r => r.data as Record<string, unknown>)
  const flagged = rows.filter(r => r.feedback === 'flagged').map(r => r.data as Record<string, unknown>)

  if (approved.length < 5 || rejected.length < 5) {
    return Response.json({
      error: 'Need at least 5 approved and 5 rejected leads to extract patterns',
    }, { status: 400 })
  }

  const columns = (table.columnsDefinition as ColumnDef[]) || []

  const patterns = await extractLearnings({
    approvedRows: approved,
    rejectedRows: rejected,
    flaggedRows: flagged,
    columns,
  })

  return Response.json({
    patterns,
    stats: {
      approved: approved.length,
      rejected: rejected.length,
      flagged: flagged.length,
      total: rows.length,
    },
  })
}
