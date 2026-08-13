import { describe, expect, it } from 'vitest'
import {
  type OutreachReadAdapter,
  type ReadMessagePageInput,
  type ReadMessagePageResult,
} from '../contracts'
import { toSafeProviderError } from '../errors'

function fakeAdapter(): OutreachReadAdapter {
  return {
    provider: 'heyreach',
    async discoverCampaigns() {
      return []
    },
    async readMessagePage(_input: ReadMessagePageInput): Promise<ReadMessagePageResult> {
      return { messages: [], nextCursor: null }
    },
  }
}

describe('outreach read adapter contract', () => {
  it('exposes only provider discovery and message page reads', () => {
    const adapter: OutreachReadAdapter = fakeAdapter()
    expect(Object.keys(adapter).sort()).toEqual(['discoverCampaigns', 'provider', 'readMessagePage'])
  })

  it('maps status-like failures to safe metadata without retaining sensitive input', () => {
    expect(toSafeProviderError({
      status: 429,
      retryAt: '2026-08-14T00:00:00Z',
      body: 'diego@example.com token=secret',
      url: 'https://provider.example/messages?api_key=secret',
    })).toEqual({
      category: 'rate_limited',
      status: 429,
      retryAt: '2026-08-14T00:00:00.000Z',
    })
    expect(toSafeProviderError({ status: 503, body: 'private response' }))
      .toEqual({ category: 'provider_unavailable', status: 503 })
    expect(toSafeProviderError({ retryAt: 'token=secret' }))
      .toEqual({ category: 'internal_error' })
  })
})
