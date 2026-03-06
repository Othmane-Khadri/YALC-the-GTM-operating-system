import { NextRequest } from 'next/server'
import { DataQualityMonitor } from '@/lib/data-quality/monitor'

export async function POST(req: NextRequest) {
  const { resultSetId } = await req.json() as { resultSetId: string }

  if (!resultSetId) {
    return Response.json({ error: 'resultSetId is required' }, { status: 400 })
  }

  const monitor = new DataQualityMonitor()
  const issues = await monitor.runAll(resultSetId)

  return Response.json({
    resultSetId,
    issueCount: issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    warning: issues.filter(i => i.severity === 'warning').length,
    info: issues.filter(i => i.severity === 'info').length,
    issues,
  })
}
