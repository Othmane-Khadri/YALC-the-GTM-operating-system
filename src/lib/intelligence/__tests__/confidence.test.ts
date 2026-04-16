import { describe, it, expect } from 'vitest'
import { calculateConfidenceScore, shouldPromote, isExpired } from '../confidence'
import type { Intelligence } from '../types'

function makeIntelligence(overrides: Partial<Intelligence> = {}): Intelligence {
  return {
    id: 'test-1',
    category: 'campaign',
    insight: 'Test insight',
    evidence: [],
    segment: null,
    channel: null,
    confidence: 'hypothesis',
    confidenceScore: 0,
    source: 'campaign_outcome',
    biasCheck: null,
    supersedes: null,
    createdAt: '2026-01-01T00:00:00Z',
    validatedAt: null,
    expiresAt: null,
    ...overrides,
  }
}

describe('calculateConfidenceScore', () => {
  it('returns 0 for no evidence', () => {
    const intel = makeIntelligence({ evidence: [] })
    expect(calculateConfidenceScore(intel)).toBe(0)
  })

  it('caps evidence score at 40', () => {
    const evidence = Array.from({ length: 10 }, (_, i) => ({
      type: 'conversion',
      sourceId: `s${i}`,
      metric: 'reply_rate',
      value: 0.1,
      sampleSize: 100,
      timestamp: '2026-01-01T00:00:00Z',
    }))
    const intel = makeIntelligence({ evidence })
    const score = calculateConfidenceScore(intel)
    // 10 evidence * 10 = 100 capped at 40, no time span (all same date), no bias
    expect(score).toBe(40)
  })

  it('adds bias check score of 30 when check passes', () => {
    const evidence = [
      { type: 'a', sourceId: 's1', metric: 'm', value: 1, sampleSize: 50, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'a', sourceId: 's2', metric: 'm', value: 1, sampleSize: 50, timestamp: '2026-01-15T00:00:00Z' },
    ]
    const biasCheck = { sampleSize: 30, segmentBalance: true, timeSpan: 14, recencyWeighted: true, checkedAt: '2026-01-15T00:00:00Z' }
    const intel = makeIntelligence({ evidence, biasCheck })
    const score = calculateConfidenceScore(intel)
    // evidence: 2*10=20, timeSpan: 14 days, bias: 30 → 64
    expect(score).toBe(64)
  })
})

describe('shouldPromote', () => {
  it('promotes hypothesis with 2+ evidence', () => {
    const evidence = [
      { type: 'a', sourceId: 's1', metric: 'm', value: 1, sampleSize: 50, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'a', sourceId: 's2', metric: 'm', value: 1, sampleSize: 50, timestamp: '2026-01-02T00:00:00Z' },
    ]
    const intel = makeIntelligence({ confidence: 'hypothesis', evidence })
    const result = shouldPromote(intel)
    expect(result.shouldPromote).toBe(true)
  })

  it('does not promote hypothesis with 1 evidence', () => {
    const evidence = [{ type: 'a', sourceId: 's1', metric: 'm', value: 1, sampleSize: 50, timestamp: '2026-01-01T00:00:00Z' }]
    const intel = makeIntelligence({ confidence: 'hypothesis', evidence })
    const result = shouldPromote(intel)
    expect(result.shouldPromote).toBe(false)
  })

  it('promotes validated with passing bias check', () => {
    const biasCheck = { sampleSize: 30, segmentBalance: true, timeSpan: 14, recencyWeighted: true, checkedAt: '2026-01-15T00:00:00Z' }
    const intel = makeIntelligence({ confidence: 'validated', biasCheck })
    const result = shouldPromote(intel)
    expect(result.shouldPromote).toBe(true)
  })

  it('returns false for proven (already at top)', () => {
    const intel = makeIntelligence({ confidence: 'proven' })
    const result = shouldPromote(intel)
    expect(result.shouldPromote).toBe(false)
  })
})

describe('isExpired', () => {
  it('returns false when no expiresAt', () => {
    const intel = makeIntelligence()
    expect(isExpired(intel)).toBe(false)
  })

  it('returns true when expiresAt is in the past', () => {
    const intel = makeIntelligence({ expiresAt: '2020-01-01T00:00:00Z' })
    expect(isExpired(intel)).toBe(true)
  })

  it('returns false when expiresAt is in the future', () => {
    const intel = makeIntelligence({ expiresAt: '2030-01-01T00:00:00Z' })
    expect(isExpired(intel)).toBe(false)
  })
})
