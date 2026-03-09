export const dynamic = 'force-dynamic'

import { db } from '@/lib/db'
import { resultSets, resultRows } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  try {
    const tables = await db.select({
      id: resultSets.id,
      name: resultSets.name,
      workflowId: resultSets.workflowId,
      columnsDefinition: resultSets.columnsDefinition,
      rowCount: resultSets.rowCount,
      createdAt: resultSets.createdAt,
    }).from(resultSets).orderBy(sql`${resultSets.createdAt} DESC`)

    // Get feedback stats with a single aggregated query
    const feedbackCounts = await db
      .select({
        resultSetId: resultRows.resultSetId,
        feedback: resultRows.feedback,
        count: sql<number>`count(*)`,
      })
      .from(resultRows)
      .groupBy(resultRows.resultSetId, resultRows.feedback)

    // Build a lookup map
    const statsMap = new Map<string, { total: number; approved: number; rejected: number; flagged: number; pending: number }>()
    for (const row of feedbackCounts) {
      if (!statsMap.has(row.resultSetId)) {
        statsMap.set(row.resultSetId, { total: 0, approved: 0, rejected: 0, flagged: 0, pending: 0 })
      }
      const stats = statsMap.get(row.resultSetId)!
      stats.total += row.count
      if (row.feedback === 'approved') stats.approved += row.count
      else if (row.feedback === 'rejected') stats.rejected += row.count
      else if (row.feedback === 'flagged') stats.flagged += row.count
      else stats.pending += row.count
    }

    const tablesWithStats = tables.map((table) => ({
      ...table,
      feedbackStats: statsMap.get(table.id) ?? { total: 0, approved: 0, rejected: 0, flagged: 0, pending: 0 },
    }))

    return Response.json({ tables: tablesWithStats })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch tables'
    return Response.json({ error: message }, { status: 500 })
  }
}
