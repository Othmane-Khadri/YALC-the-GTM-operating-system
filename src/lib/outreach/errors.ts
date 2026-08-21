export type ProviderErrorCategory =
  | 'unauthorized'
  | 'forbidden'
  | 'payment_required'
  | 'rate_limited'
  | 'invalid_payload'
  | 'provider_unavailable'
  | 'internal_error'

/** Safe to persist or return: it deliberately has no provider body, URL, or credential. */
export interface SafeProviderError {
  category: ProviderErrorCategory
  status?: number
  retryAt?: string
}

function statusFrom(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  const status = (error as { status: unknown }).status
  return typeof status === 'number' && Number.isInteger(status) ? status : undefined
}

function retryAtFrom(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('retryAt' in error)) return undefined
  const retryAt = (error as { retryAt: unknown }).retryAt
  if (typeof retryAt !== 'string' || Number.isNaN(Date.parse(retryAt))) return undefined
  return new Date(retryAt).toISOString()
}

function categoryForStatus(status: number | undefined): ProviderErrorCategory {
  switch (status) {
    case 401: return 'unauthorized'
    case 402: return 'payment_required'
    case 403: return 'forbidden'
    case 429: return 'rate_limited'
  }
  if (status !== undefined && status >= 400 && status < 500) return 'invalid_payload'
  if (status !== undefined && status >= 500 && status < 600) return 'provider_unavailable'
  return 'internal_error'
}

/**
 * Redacts an unknown provider failure into the only metadata callers may
 * retain. Do not attach the source error as a cause or add a message here.
 */
export function toSafeProviderError(error: unknown): SafeProviderError {
  const status = statusFrom(error)
  const retryAt = retryAtFrom(error)
  return {
    category: categoryForStatus(status),
    ...(status === undefined ? {} : { status }),
    ...(retryAt === undefined ? {} : { retryAt }),
  }
}
