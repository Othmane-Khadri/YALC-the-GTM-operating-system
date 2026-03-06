import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db'
import { providerStats } from '../db/schema'

export interface ProviderStats {
  providerId: string
  metrics: {
    accuracy: number
    avgLatencyMs: number
    avgCostPerCall: number
    coverageScore: number
    sampleSize: number
  }
  segment: string | null
}

export async function aggregateStats(providerId: string, segment?: string): Promise<ProviderStats> {
  const conditions = [eq(providerStats.providerId, providerId)]
  if (segment) {
    conditions.push(eq(providerStats.segment, segment))
  }

  const rows = await db
    .select()
    .from(providerStats)
    .where(and(...conditions))
    .orderBy(desc(providerStats.measuredAt))

  const metricGroups: Record<string, { total: number; count: number }> = {
    accuracy: { total: 0, count: 0 },
    latency_ms: { total: 0, count: 0 },
    cost_per_call: { total: 0, count: 0 },
    coverage: { total: 0, count: 0 },
  }

  for (const row of rows) {
    const group = metricGroups[row.metric]
    if (group) {
      group.total += row.value * (row.sampleSize ?? 1)
      group.count += row.sampleSize ?? 1
    }
  }

  const avg = (g: { total: number; count: number }) => g.count > 0 ? g.total / g.count : 0

  return {
    providerId,
    metrics: {
      accuracy: avg(metricGroups.accuracy),
      avgLatencyMs: avg(metricGroups.latency_ms),
      avgCostPerCall: avg(metricGroups.cost_per_call),
      coverageScore: avg(metricGroups.coverage),
      sampleSize: rows.length,
    },
    segment: segment ?? null,
  }
}
