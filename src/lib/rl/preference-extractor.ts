// ─── Preference Extractor ────────────────────────────────────────────────────
// Analyzes swipe results and persists rules to Intelligence Store.

import { IntelligenceStore } from '../intelligence/store'

interface SwipeResult {
  id: number
  verdict: 'like' | 'dislike'
  comment: string | null
  time_spent_ms: number
}

interface Sample {
  id: number
  content: string
  dimensions: Record<string, string>
}

export interface PreferenceRule {
  strength: 'strong' | 'mild'
  dimension: string
  description: string
  spread: number
  preferredValue: string
  avoidValue: string
}

export interface PreferenceAnalysis {
  rules: PreferenceRule[]
  commentInsights: string[]
  likeRate: number
  totalSamples: number
}

export function analyzePreferences(
  results: SwipeResult[],
  samples: Sample[],
): PreferenceAnalysis {
  const liked = results.filter((r) => r.verdict === 'like')
  const likeRate = results.length > 0 ? liked.length / results.length : 0

  // Build contingency tables per dimension
  const allDimensions = new Set<string>()
  for (const s of samples) {
    for (const key of Object.keys(s.dimensions || {})) {
      allDimensions.add(key)
    }
  }

  const rules: PreferenceRule[] = []

  for (const dim of allDimensions) {
    const valueStats: Record<string, { liked: number; total: number }> = {}

    for (const result of results) {
      const sample = samples.find((s) => s.id === result.id)
      if (!sample) continue
      const val = sample.dimensions?.[dim]
      if (!val) continue

      if (!valueStats[val]) valueStats[val] = { liked: 0, total: 0 }
      valueStats[val].total++
      if (result.verdict === 'like') valueStats[val].liked++
    }

    const entries = Object.entries(valueStats)
    if (entries.length < 2) continue

    const rates = entries.map(([value, s]) => ({
      value,
      likeRate: s.total > 0 ? s.liked / s.total : 0,
      count: s.total,
    }))

    const maxRate = Math.max(...rates.map((r) => r.likeRate))
    const minRate = Math.min(...rates.map((r) => r.likeRate))
    const spread = (maxRate - minRate) * 100

    if (spread < 30) continue

    const best = rates.reduce((a, b) => (a.likeRate > b.likeRate ? a : b))
    const worst = rates.reduce((a, b) => (a.likeRate < b.likeRate ? a : b))

    const strength: 'strong' | 'mild' = spread > 60 ? 'strong' : 'mild'

    // Require minimum samples for strong rules
    if (strength === 'strong' && (best.count < 3 || worst.count < 3)) continue

    rules.push({
      strength,
      dimension: dim,
      description: `Prefer "${best.value}" ${dim} (${Math.round(best.likeRate * 100)}% liked) over "${worst.value}" (${Math.round(worst.likeRate * 100)}% liked)`,
      spread: Math.round(spread),
      preferredValue: best.value,
      avoidValue: worst.value,
    })
  }

  // Extract comment insights
  const commentInsights: string[] = []
  for (const r of results) {
    if (r.comment) {
      const prefix = r.verdict === 'like' ? 'Liked' : 'Disliked'
      commentInsights.push(`[${prefix}] "${r.comment}"`)
    }
  }

  return {
    rules,
    commentInsights,
    likeRate: Math.round(likeRate * 100),
    totalSamples: results.length,
  }
}

/**
 * Persist strong preference rules to the Intelligence Store.
 */
export async function persistToIntelligenceStore(
  skillId: string,
  analysis: PreferenceAnalysis,
): Promise<number> {
  const store = new IntelligenceStore()
  let persisted = 0

  for (const rule of analysis.rules) {
    if (rule.strength !== 'strong') continue

    const now = new Date().toISOString()
    await store.add({
      category: 'content',
      insight: `[${skillId}] ${rule.description}`,
      evidence: [
        {
          type: 'preference',
          sourceId: `rl-${skillId}`,
          metric: rule.dimension,
          value: rule.spread,
          sampleSize: analysis.totalSamples,
          timestamp: now,
        },
      ],
      source: 'rlhf',
      confidence: 'validated',
      segment: null,
      channel: null,
      biasCheck: null,
      supersedes: null,
      validatedAt: now,
      expiresAt: null,
    })
    persisted++
  }

  // Persist comment insights as a batch
  if (analysis.commentInsights.length > 0) {
    const now = new Date().toISOString()
    await store.add({
      category: 'content',
      insight: `[${skillId}] User feedback: ${analysis.commentInsights.join('; ')}`,
      evidence: [
        {
          type: 'user_comment',
          sourceId: `rl-${skillId}-comments`,
          metric: 'feedback',
          value: analysis.commentInsights.length,
          sampleSize: analysis.totalSamples,
          timestamp: now,
        },
      ],
      source: 'rlhf',
      confidence: 'validated',
      segment: null,
      channel: null,
      biasCheck: null,
      supersedes: null,
      validatedAt: now,
      expiresAt: null,
    })
    persisted++
  }

  return persisted
}
