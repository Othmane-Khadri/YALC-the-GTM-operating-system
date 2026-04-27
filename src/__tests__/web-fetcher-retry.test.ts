import { describe, it, expect } from 'vitest'
import {
  RETRY_DELAYS_MS,
  isAuthFailure,
  withRetry,
  THIN_CONTENT_THRESHOLD,
} from '../lib/web/fetcher'

/**
 * Item 18 — Web fetcher retry wrapper.
 *
 * The contract:
 *   - `withRetry` runs the operation up to 3 times, with the documented
 *     1s / 3s / 9s backoff between attempts.
 *   - `isAuthFailure(err)` is true for 401/403/404 and short-circuits the
 *     loop — those errors mean the keys/scope/URL are wrong, not transient.
 *   - Anything else (timeouts, 5xx, generic Error) gets retried.
 *   - Tests inject a synthetic `sleepFn` so we never block on real wallclock.
 */

const noSleep = async (_ms: number) => {}

describe('isAuthFailure', () => {
  it('returns true for 401 / 403 / 404 errors', () => {
    expect(isAuthFailure(new Error('Fetch failed: 401 Unauthorized'))).toBe(true)
    expect(isAuthFailure(new Error('403 Forbidden'))).toBe(true)
    expect(isAuthFailure(new Error('site responded 404 Not Found'))).toBe(true)
  })

  it('returns false for 5xx, timeouts, and generic errors', () => {
    expect(isAuthFailure(new Error('Fetch failed: 503 Service Unavailable'))).toBe(false)
    expect(isAuthFailure(new Error('Fetch failed: 500 Internal Server Error'))).toBe(false)
    expect(isAuthFailure(new Error('AbortError: signal timed out'))).toBe(false)
    expect(isAuthFailure(new Error('ECONNRESET'))).toBe(false)
    expect(isAuthFailure('socket hang up')).toBe(false)
  })
})

describe('withRetry', () => {
  it('retries up to 3 attempts on transient errors and returns success', async () => {
    let attempts = 0
    const op = async () => {
      attempts += 1
      if (attempts < 3) throw new Error('Fetch failed: 503 Service Unavailable')
      return 'ok'
    }

    const result = await withRetry(op, { label: 'test', sleepFn: noSleep })
    expect(result).toBe('ok')
    expect(attempts).toBe(3)
  })

  it('throws the last error after 3 failed attempts', async () => {
    let attempts = 0
    const op = async () => {
      attempts += 1
      throw new Error(`failure #${attempts}`)
    }

    await expect(withRetry(op, { label: 'test', sleepFn: noSleep })).rejects.toThrow(
      'failure #3',
    )
    expect(attempts).toBe(3)
  })

  it('short-circuits on auth failure (no retries)', async () => {
    let attempts = 0
    const op = async () => {
      attempts += 1
      throw new Error('Fetch failed: 401 Unauthorized')
    }

    await expect(withRetry(op, { label: 'test', sleepFn: noSleep })).rejects.toThrow(/401/)
    expect(attempts).toBe(1)
  })

  it('sleeps with the documented 1s / 3s schedule between attempts (no sleep after final)', async () => {
    const delays: number[] = []
    let attempts = 0
    const op = async () => {
      attempts += 1
      throw new Error('Fetch failed: 503')
    }
    const sleepFn = async (ms: number) => {
      delays.push(ms)
    }

    await expect(withRetry(op, { label: 'test', sleepFn })).rejects.toThrow()
    // 3 attempts -> 2 inter-attempt sleeps -> 1000ms then 3000ms.
    expect(delays).toEqual([RETRY_DELAYS_MS[0], RETRY_DELAYS_MS[1]])
    expect(attempts).toBe(3)
  })

  it('exposes the canonical 1s / 3s / 9s schedule via RETRY_DELAYS_MS', () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 3000, 9000])
  })
})

describe('THIN_CONTENT_THRESHOLD', () => {
  it('matches the documented 500-char bar', () => {
    expect(THIN_CONTENT_THRESHOLD).toBe(500)
  })
})
