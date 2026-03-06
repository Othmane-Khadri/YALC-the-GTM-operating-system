import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dataQualityLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { QualityIssue } from '@/lib/data-quality/types'

export async function GET() {
  const rows = await db
    .select()
    .from(dataQualityLog)
    .where(eq(dataQualityLog.resolved, 0))
    .orderBy(desc(dataQualityLog.createdAt))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issues: QualityIssue[] = rows.map((r: any) => ({
    id: r.id,
    resultSetId: r.resultSetId,
    rowId: r.rowId,
    checkType: r.checkType,
    severity: r.severity,
    details: typeof r.details === 'string' ? JSON.parse(r.details) : (r.details ?? {}),
    nudge: r.nudge,
    action: r.action ? (typeof r.action === 'string' ? JSON.parse(r.action) : r.action) : null,
    resolved: r.resolved === 1,
    createdAt: r.createdAt,
  }))

  return Response.json({ issues })
}

export async function PATCH(req: NextRequest) {
  const { issueId } = await req.json() as { issueId: string }

  if (!issueId) {
    return Response.json({ error: 'issueId is required' }, { status: 400 })
  }

  await db
    .update(dataQualityLog)
    .set({ resolved: 1, resolvedAt: new Date().toISOString() })
    .where(eq(dataQualityLog.id, issueId))

  return Response.json({ resolved: true })
}
