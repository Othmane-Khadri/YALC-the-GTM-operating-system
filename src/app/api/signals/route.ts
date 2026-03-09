import { NextRequest } from 'next/server'
import { getCollector } from '@/lib/signals/collector'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const type = url.searchParams.get('type') ?? undefined
    const category = url.searchParams.get('category') ?? undefined
    const sinceParam = url.searchParams.get('since')

    const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 24 * 60 * 60 * 1000)

    const collector = getCollector()

    let signals
    if (type) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signals = await collector.getRecentByType(since, type as any)
    } else {
      signals = await collector.getRecent(since, category)
    }

    const count = await collector.getCount(since)

    return Response.json({ count, signals })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch signals'
    return Response.json({ error: message }, { status: 500 })
  }
}
