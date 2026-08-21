import type { OutreachProvider } from './contracts.js'
import { toSafeProviderError, type SafeProviderError } from './errors.js'

export const PROVIDER_MIN_INTERVAL_MS = {
  instantly: 3_000,
  heyreach: 1_100,
} as const

export interface ProviderPacer {
  wait(provider: OutreachProvider): Promise<void>
}

export interface ProviderReadRetryOptions<T> {
  provider: OutreachProvider
  pacer: ProviderPacer
  read(): Promise<T>
  /** Injectable delay seam; production callers use the default sleep. */
  wait?(ms: number): Promise<void>
  maxAttempts?: number
  maxDelayMs?: number
}

export class ProviderReadFailure extends Error {
  constructor(readonly safeError: SafeProviderError) {
    super(`Provider read failed: ${safeError.category}`)
    this.name = 'ProviderReadFailure'
  }
}

function safeErrorFrom(error: unknown): SafeProviderError {
  if (typeof error === 'object' && error !== null && 'safeError' in error) {
    const candidate = (error as { safeError: unknown }).safeError
    if (typeof candidate === 'object' && candidate !== null && 'category' in candidate) {
      return candidate as SafeProviderError
    }
  }
  return toSafeProviderError(error)
}

function defaultWait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Bounded retry policy for read-only provider calls. Only explicitly transient
 * safe categories retry; all authorization and payload errors fail immediately.
 */
export async function retryProviderRead<T>(options: ProviderReadRetryOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const maxDelayMs = options.maxDelayMs ?? 2_000
  const wait = options.wait ?? defaultWait
  let attempt = 0

  while (attempt < maxAttempts) {
    // Pace every actual request attempt, including retries. The shared pacer
    // instance serializes reservations across concurrent sync runs.
    await options.pacer.wait(options.provider)
    try {
      return await options.read()
    } catch (error) {
      const safeError = safeErrorFrom(error)
      attempt += 1
      const retryable = safeError.category === 'rate_limited' || safeError.category === 'provider_unavailable'
      if (!retryable || attempt >= maxAttempts) throw new ProviderReadFailure(safeError)
      await wait(Math.min(250 * (2 ** (attempt - 1)), maxDelayMs))
    }
  }

  throw new ProviderReadFailure({ category: 'internal_error' })
}

/** Injectable, serialized per-provider pacing without background timers. */
export function createProviderPacer(options: {
  now?: () => number
  sleep?: (ms: number) => Promise<void>
} = {}): ProviderPacer {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? defaultWait
  const lastRead = new Map<OutreachProvider, number>()
  const queues = new Map<OutreachProvider, Promise<void>>()
  return {
    async wait(provider) {
      const previousReservation = queues.get(provider) ?? Promise.resolve()
      const reservation = previousReservation.catch(() => {}).then(async () => {
        const previousRead = lastRead.get(provider)
        const current = now()
        const delay = previousRead === undefined
          ? 0
          : Math.max(0, PROVIDER_MIN_INTERVAL_MS[provider] - (current - previousRead))
        if (delay > 0) await sleep(delay)
        lastRead.set(provider, now())
      })
      queues.set(provider, reservation)
      try {
        await reservation
      } finally {
        if (queues.get(provider) === reservation) queues.delete(provider)
      }
    },
  }
}
