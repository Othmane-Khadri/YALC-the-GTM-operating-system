import { db } from '@/lib/db'
import { resultSets, resultRows } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'

export async function GET() {
  const tables = await db.select({
    id: resultSets.id,
    name: resultSets.name,
    workflowId: resultSets.workflowId,
    columnsDefinition: resultSets.columnsDefinition,
    rowCount: resultSets.rowCount,
    createdAt: resultSets.createdAt,
  }).from(resultSets).orderBy(sql`${resultSets.createdAt} DESC`)

  // Get feedback stats for each table
  const tablesWithStats = await Promise.all(
    tables.map(async (table) => {
      const rows = await db.select({ feedback: resultRows.feedback })
        .from(resultRows)
        .where(eq(resultRows.resultSetId, table.id))

      return {
        ...table,
        feedbackStats: {
          total: rows.length,
          approved: rows.filter(r => r.feedback === 'approved').length,
          rejected: rows.filter(r => r.feedback === 'rejected').length,
          flagged: rows.filter(r => r.feedback === 'flagged').length,
          pending: rows.filter(r => r.feedback === null).length,
        },
      }
    })
  )

  return Response.json({ tables: tablesWithStats })
}
