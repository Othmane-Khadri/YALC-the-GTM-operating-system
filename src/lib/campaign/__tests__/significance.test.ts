import { describe, it, expect } from 'vitest'
import { calculateSignificance } from '../significance'

describe('calculateSignificance', () => {
  it('detects clearly significant difference', () => {
    const result = calculateSignificance(
      { sends: 1000, conversions: 50 },
      { sends: 1000, conversions: 10 },
    )
    expect(result.significant).toBe(true)
    expect(result.winner).toBeDefined()
    expect(result.pValue).toBeLessThan(0.05)
    expect(result.liftPercent).toBeGreaterThan(0)
  })

  it('detects insignificant difference', () => {
    const result = calculateSignificance(
      { sends: 1000, conversions: 50 },
      { sends: 1000, conversions: 48 },
    )
    expect(result.significant).toBe(false)
  })

  it('handles zero sends gracefully', () => {
    const result = calculateSignificance(
      { sends: 0, conversions: 0 },
      { sends: 1000, conversions: 50 },
    )
    expect(result.significant).toBe(false)
    expect(result.pValue).toBe(1)
  })

  it('returns not significant for identical rates', () => {
    const result = calculateSignificance(
      { sends: 500, conversions: 25 },
      { sends: 500, conversions: 25 },
    )
    expect(result.significant).toBe(false)
    expect(result.liftPercent).toBe(0)
  })
})
