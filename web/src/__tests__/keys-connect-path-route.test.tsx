/**
 * Tests for the path-style /keys/connect/<provider> route (0.9.6 / A5).
 *
 * Doctor's missing-key URLs are formatted as
 * `http://localhost:3847/keys/connect/<provider>` (path style), but the
 * SPA's KeysConnect originally only read `?provider=<id>` from the query
 * string. This test pins the route shape so the two stay aligned.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App'
import { setApiToken } from '../lib/api'

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setApiToken(undefined)
  fetchSpy = vi.fn()
  ;(globalThis as { window?: unknown }).window = {
    location: {
      origin: 'http://localhost:3847',
      pathname: '/keys/connect/crustdata',
      search: '',
      href: 'http://localhost:3847/keys/connect/crustdata',
    },
    history: { pushState: vi.fn(), back: vi.fn(), length: 1 },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  ;(globalThis as { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { fetch?: typeof fetch }).fetch
  vi.restoreAllMocks()
})

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

describe('App router — /keys/connect/<provider>', () => {
  it('mounts the KeysConnect page when the path includes a provider segment', () => {
    fetchSpy.mockResolvedValue(jsonResponse({ providers: [] }))
    const html = renderToStaticMarkup(<App />)
    // KeysConnect's primary form testid is the canary that the right
    // page mounted.
    expect(html).toContain('keys-connect-form')
    expect(html).toContain('keys-connect-primary')
  })
})
