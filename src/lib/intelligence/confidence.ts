import type { Intelligence, BiasCheck } from './types'

/**
 * Confidence score formula (max 100):
 *   evidence_count * 10  (capped at 40)
 * + time_span_days        (capped at 30)
 * + bias_check_passed * 30
 * = max 100
 */
export function calculateConfidenceScore(intelligence: Intelligence): number {
  const evidenceScore = Math.min(intelligence.evidence.length * 10, 40)

  let timeSpanScore = 0
  if (intelligence.evidence.length >= 2) {
    const timestamps = intelligence.evidence.map(e => new Date(e.timestamp).getTime())
    const spanMs = Math.max(...timestamps) - Math.min(...timestamps)
    const spanDays = spanMs / (1000 * 60 * 60 * 24)
    timeSpanScore = Math.min(Math.round(spanDays), 30)
  }

  const biasScore = intelligence.biasCheck
    && intelligence.biasCheck.sampleSize >= 30
    && intelligence.biasCheck.segmentBalance
    && intelligence.biasCheck.timeSpan >= 14
    ? 30
    : 0

  return Math.min(evidenceScore + timeSpanScore + biasScore, 100)
}

/**
 * Determine if an intelligence entry should be promoted to the next confidence level.
 *
 * hypothesis -> validated: needs at least 2 evidence entries
 * validated  -> proven:    needs a passing bias check
 */
export function shouldPromote(
  intelligence: Intelligence
): { shouldPromote: boolean; reason: string } {
  if (intelligence.confidence === 'hypothesis') {
    if (intelligence.evidence.length >= 2) {
      return { shouldPromote: true, reason: 'Has 2+ evidence entries — ready for validated' }
    }
    return { shouldPromote: false, reason: `Only ${intelligence.evidence.length} evidence entry (need 2+)` }
  }

  if (intelligence.confidence === 'validated') {
    if (
      intelligence.biasCheck
      && intelligence.biasCheck.sampleSize >= 30
      && intelligence.biasCheck.segmentBalance
      && intelligence.biasCheck.timeSpan >= 14
    ) {
      return { shouldPromote: true, reason: 'Bias check passed — ready for proven' }
    }
    return {
      shouldPromote: false,
      reason: intelligence.biasCheck
        ? `Bias check incomplete: sample=${intelligence.biasCheck.sampleSize}, balanced=${intelligence.biasCheck.segmentBalance}, span=${intelligence.biasCheck.timeSpan}d`
        : 'No bias check performed yet',
    }
  }

  return { shouldPromote: false, reason: 'Already at highest confidence level' }
}

/**
 * Check if an intelligence entry has expired.
 */
export function isExpired(intelligence: Intelligence): boolean {
  if (!intelligence.expiresAt) return false
  return new Date(intelligence.expiresAt).getTime() < Date.now()
}
