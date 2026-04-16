// ─── A/B Test Statistical Significance ──────────────────────────────────────
// Chi-squared test for comparing variant conversion rates.
// Used by campaign:report, visualize-campaigns, and auto-pause in tracker.

export interface SignificanceResult {
  significant: boolean
  pValue: number
  winner?: 'A' | 'B'
  liftPercent: number
  minSampleNeeded: number
}

/**
 * Chi-squared test for two variant conversion rates.
 * Returns significance at p < 0.05 and minimum sample needed.
 */
export function calculateSignificance(
  variantA: { sends: number; conversions: number },
  variantB: { sends: number; conversions: number },
): SignificanceResult {
  const { sends: nA, conversions: cA } = variantA
  const { sends: nB, conversions: cB } = variantB

  // Not enough data
  if (nA === 0 || nB === 0) {
    return { significant: false, pValue: 1, liftPercent: 0, minSampleNeeded: 30 }
  }

  const rateA = cA / nA
  const rateB = cB / nB

  // Pooled rate
  const totalConversions = cA + cB
  const totalSends = nA + nB
  const pooledRate = totalConversions / totalSends

  // Expected values under null hypothesis (no difference)
  const eA1 = nA * pooledRate       // expected conversions A
  const eA0 = nA * (1 - pooledRate) // expected non-conversions A
  const eB1 = nB * pooledRate       // expected conversions B
  const eB0 = nB * (1 - pooledRate) // expected non-conversions B

  // Avoid division by zero
  if (eA1 === 0 || eA0 === 0 || eB1 === 0 || eB0 === 0) {
    return { significant: false, pValue: 1, liftPercent: 0, minSampleNeeded: 30 }
  }

  // Chi-squared statistic (2x2 contingency table)
  const chiSquared =
    Math.pow(cA - eA1, 2) / eA1 +
    Math.pow((nA - cA) - eA0, 2) / eA0 +
    Math.pow(cB - eB1, 2) / eB1 +
    Math.pow((nB - cB) - eB0, 2) / eB0

  // p-value approximation for 1 degree of freedom
  // Using Wilson-Hilferty approximation of chi-squared CDF
  const pValue = chiSquaredPValue(chiSquared, 1)

  const significant = pValue < 0.05 && nA >= 30 && nB >= 30

  // Determine winner
  let winner: 'A' | 'B' | undefined
  if (significant) {
    winner = rateA > rateB ? 'A' : 'B'
  }

  // Lift
  const baseRate = Math.min(rateA, rateB)
  const liftPercent = baseRate > 0
    ? ((Math.max(rateA, rateB) - baseRate) / baseRate) * 100
    : 0

  // Minimum sample needed for significance (rule of thumb: 16 * pooledRate * (1-pooledRate) / (rateA - rateB)^2)
  const diff = Math.abs(rateA - rateB)
  const minSampleNeeded = diff > 0
    ? Math.ceil(16 * pooledRate * (1 - pooledRate) / (diff * diff))
    : 100

  return { significant, pValue, winner, liftPercent, minSampleNeeded }
}

/**
 * Approximate p-value for chi-squared statistic with given degrees of freedom.
 * Uses the regularized incomplete gamma function approximation.
 */
function chiSquaredPValue(x: number, df: number): number {
  if (x <= 0) return 1
  // For df=1, use the complementary error function approximation
  if (df === 1) {
    // P(X > x) = erfc(sqrt(x/2))
    return erfc(Math.sqrt(x / 2))
  }
  // General case: use series expansion for regularized incomplete gamma
  return 1 - regularizedGammaP(df / 2, x / 2)
}

/**
 * Complementary error function approximation (Abramowitz and Stegun).
 */
function erfc(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x))
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const result = poly * Math.exp(-x * x)
  return x >= 0 ? result : 2 - result
}

/**
 * Regularized incomplete gamma function P(a, x) via series expansion.
 */
function regularizedGammaP(a: number, x: number): number {
  if (x === 0) return 0
  let sum = 1 / a
  let term = 1 / a
  for (let n = 1; n < 200; n++) {
    term *= x / (a + n)
    sum += term
    if (Math.abs(term) < 1e-12 * Math.abs(sum)) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))
}

/**
 * Log-gamma function (Stirling's approximation).
 */
function lnGamma(x: number): number {
  if (x <= 0) return 0
  // Lanczos approximation
  const g = 7
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ]
  let sum = c[0]
  for (let i = 1; i < g + 2; i++) {
    sum += c[i] / (x + i - 1)
  }
  const t = x + g - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (x - 0.5) * Math.log(t) - t + Math.log(sum)
}
