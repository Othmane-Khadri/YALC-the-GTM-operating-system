import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { dataQualityLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { QualityIssue, QualityAction } from '@/lib/data-quality/types'

function safeJsonParse(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}

export async function GET() {
  try {
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
      details: safeJsonParse(r.details, {}) as Record<string, unknown>,
      nudge: r.nudge,
      action: r.action ? safeJsonParse(r.action, null) as QualityAction : null,
      resolved: r.resolved === 1,
      createdAt: r.createdAt,
    }))

    return Response.json({ issues })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch data quality issues'
    return Response.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { issueId } = await req.json() as { issueId: string }

    if (!issueId) {
      return Response.json({ error: 'issueId is required' }, { status: 400 })
    }

    await db
      .update(dataQualityLog)
      .set({ resolved: 1, resolvedAt: new Date().toISOString() })
      .where(eq(dataQualityLog.id, issueId))

    return Response.json({ resolved: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to resolve issue'
    return Response.json({ error: message }, { status: 500 })
  }
}
