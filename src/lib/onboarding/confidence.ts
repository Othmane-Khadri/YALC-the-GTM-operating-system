/**
 * Preview confidence scoring (0.8.F).
 *
 * Each section that synthesis writes carries a 0..1 confidence score so the
 * doctor + `--regenerate-low-confidence` can flag thin output. The score is
 * a deterministic blend of three signals — input volume, the LLM's own
 * self-rating, and whether the section was anchored to extracted metadata.
 *
 * Confidence is a data layer only in 0.8.0: nothing auto-commits or
 * auto-rejects based on it. 0.9.0 will wire the score into the commit flow.
 */

/** Per-section confidence inputs captured at synthesis time. */
export interface ConfidenceSignals {
  /** Raw character count of the source content that fed this section. */
  input_chars: number
  /** LLM's self-rated confidence on a 0..10 scale. Default to 5 when missing. */
  llm_self_rating: number
  /** True if extracted from rich meta tags / canonical sources. */
  has_metadata_anchors: boolean
}

/**
 * Initial blend: 40% character volume (saturating at 5,000 chars), 40% LLM
 * self-rating, 20% metadata anchor bonus. Returns a value in [0, 1].
 *
 * Stays a pure function so the doctor + tests can reuse it without dragging
 * the synthesis module along.
 */
export function computeConfidence(signals: ConfidenceSignals): number {
  const charsScore = Math.min(Math.max(signals.input_chars, 0) / 5000, 1)
  const llmScore = Math.min(Math.max(signals.llm_self_rating, 0), 10) / 10
  const anchorScore = signals.has_metadata_anchors ? 1 : 0
  return 0.4 * charsScore + 0.4 * llmScore + 0.2 * anchorScore
}

/**
 * Default LLM self-rating when the model didn't emit `__yalc_confidence`
 * (or emitted a malformed value). Picked to land mid-range so a missing
 * field never becomes a confident signal in either direction.
 */
export const DEFAULT_LLM_SELF_RATING = 5

/** High/medium/low buckets used by doctor to summarize per-section scores. */
export type ConfidenceBucket = 'high' | 'medium' | 'low'

export function bucketForConfidence(score: number): ConfidenceBucket {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}
