import { randomUUID } from 'crypto'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db'
import { providerStats, providerPreferences } from '../db/schema'
import { aggregateStats } from './stats'
import type { ProviderStats } from './stats'

interface RecordParams {
  stepType: string
}

interface RecordResult {
  rowCount: number
  latencyMs: number
  costEstimate: number
  qualityScore?: number
}

interface BestProviderRequest {
  stepType: string
  capabilities: string[]
  segment?: string
  budgetLimit?: number
  preferQuality?: boolean
}

interface BestProviderResult {
  providerId: string
  reason: string
  estimatedCost: number
  alternatives: { providerId: string; reason: string }[]
}

export class ProviderIntelligence {
  async recordExecution(
    providerId: string,
    step: RecordParams,
    result: RecordResult,
    segment?: string,
  ): Promise<void> {
    const now = new Date().toISOString()
    const base = { providerId, segment: segment ?? null, sampleSize: 1, measuredAt: now }

    // Record accuracy (quality score 0-100, default 50)
    await db.insert(providerStats).values({
      id: randomUUID(),
      ...base,
      metric: 'accuracy',
      value: result.qualityScore ?? 50,
    })

    // Record latency
    await db.insert(providerStats).values({
      id: randomUUID(),
      ...base,
      metric: 'latency_ms',
      value: result.latencyMs,
    })

    // Record cost per call
    await db.insert(providerStats).values({
      id: randomUUID(),
      ...base,
      metric: 'cost_per_call',
      value: result.costEstimate,
    })

    // Record coverage (rows produced)
    await db.insert(providerStats).values({
      id: randomUUID(),
      ...base,
      metric: 'coverage',
      value: result.rowCount,
      sampleSize: result.rowCount,
    })
  }

  async getBestProvider(request: BestProviderRequest): Promise<BestProviderResult | null> {
    // Check user preferences first
    const prefs = await db
      .select()
      .from(providerPreferences)
      .where(
        and(
          eq(providerPreferences.skillId, request.stepType),
          ...(request.segment ? [eq(providerPreferences.segment, request.segment)] : []),
        )
      )
      .orderBy(desc(providerPreferences.createdAt))
      .limit(1)

    if (prefs.length > 0 && prefs[0].source === 'user') {
      return {
        providerId: prefs[0].preferredProvider,
        reason: `User preference: ${prefs[0].reason ?? 'manually selected'}`,
        estimatedCost: 0,
        alternatives: [],
      }
    }

    // Get all unique provider IDs from stats
    const allStats = await db
      .select({ providerId: providerStats.providerId })
      .from(providerStats)

    const uniqueProviders = [...new Set(allStats.map(r => r.providerId))]
    if (uniqueProviders.length === 0) return null

    // Aggregate stats for each provider
    const scored: { providerId: string; score: number; stats: ProviderStats }[] = []

    for (const pid of uniqueProviders) {
      const stats = await aggregateStats(pid, request.segment)
      if (stats.metrics.sampleSize === 0) continue

      // Score = weighted combination
      // Quality preference: accuracy weighted heavily
      // Cost preference: inverse cost weighted
      const qualityWeight = request.preferQuality ? 0.5 : 0.3
      const costWeight = request.preferQuality ? 0.1 : 0.3
      const latencyWeight = 0.2
      const coverageWeight = 0.2

      const normalizedAccuracy = stats.metrics.accuracy / 100
      const normalizedLatency = Math.max(0, 1 - (stats.metrics.avgLatencyMs / 10000))
      const normalizedCost = stats.metrics.avgCostPerCall > 0
        ? Math.max(0, 1 - (stats.metrics.avgCostPerCall / (request.budgetLimit ?? 1)))
        : 1
      const normalizedCoverage = Math.min(1, stats.metrics.coverageScore / 100)

      const score =
        (normalizedAccuracy * qualityWeight) +
        (normalizedCost * costWeight) +
        (normalizedLatency * latencyWeight) +
        (normalizedCoverage * coverageWeight)

      scored.push({ providerId: pid, score, stats })
    }

    if (scored.length === 0) return null

    scored.sort((a, b) => b.score - a.score)

    const best = scored[0]
    const alternatives = scored.slice(1, 3).map(s => ({
      providerId: s.providerId,
      reason: `Score: ${(s.score * 100).toFixed(0)}% (accuracy: ${s.stats.metrics.accuracy.toFixed(0)}, cost: $${s.stats.metrics.avgCostPerCall.toFixed(3)})`,
    }))

    return {
      providerId: best.providerId,
      reason: `Best score: ${(best.score * 100).toFixed(0)}% across ${best.stats.metrics.sampleSize} executions`,
      estimatedCost: best.stats.metrics.avgCostPerCall,
      alternatives,
    }
  }

  async getStats(providerId: string, segment?: string): Promise<ProviderStats> {
    return aggregateStats(providerId, segment)
  }

  async setPreference(
    skillId: string,
    segment: string | null,
    providerId: string,
    reason: string,
    source: 'auto' | 'user',
  ): Promise<void> {
    await db.insert(providerPreferences).values({
      id: randomUUID(),
      skillId,
      segment,
      preferredProvider: providerId,
      reason,
      source,
      createdAt: new Date().toISOString(),
    })
  }
}
