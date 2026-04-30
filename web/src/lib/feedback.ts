/**
 * Tiny shared helpers for the SPA pages.
 *
 * Pulled out of individual page modules so the same logic isn't bundled
 * once per page (the SPA budget is tight — see web-bundle-build.test.ts).
 */

import { ApiError } from './api'

/** Map a 0..1 score to a confidence bucket. */
export function bucketForConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

/**
 * Status-tinted badge classes — green / amber / rose. tokens.json doesn't
 * ship a green/yellow/red triplet so the hex literals below are kept as
 * inline values rather than tokens. 0.9.G can tighten if needed.
 */
export function bucketBadgeClass(bucket: 'high' | 'medium' | 'low'): string {
  if (bucket === 'high') return 'bg-[#3F8F5A] text-white border-transparent'
  if (bucket === 'medium') return 'bg-[#D4A23A] text-white border-transparent'
  return 'bg-[#C9506E] text-white border-transparent'
}

/** Pull a user-facing message out of either ApiError, Error, or unknown. */
export function describeError(err: unknown, fallback = 'Request failed'): string {
  if (err instanceof ApiError) {
    if (err.body && typeof err.body === 'object' && 'message' in err.body) {
      return String((err.body as { message: unknown }).message)
    }
    return `${fallback} (${err.status})`
  }
  if (err instanceof Error) return err.message
  return fallback
}

/**
 * Common <pre> block class string used by every read-only viewer (Brain,
 * Skills, Today). Centralised so the literal isn't duplicated across pages
 * — the SPA bundle budget is tight.
 */
export const preBlockClass =
  'rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-words max-h-[420px] overflow-auto'

/** Class string applied by every page header's eyebrow / kicker `<p>`. */
export const eyebrowClass =
  'font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2'
