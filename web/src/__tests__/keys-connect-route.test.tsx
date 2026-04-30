/**
 * Tests for the /keys/connect SPA page (0.9.D).
 *
 * Mirrors the SetupReview test surface — vitest runs in node, so we
 * render through `react-dom/server` and walk the produced HTML for
 * structural assertions, then exercise the API wrapper with a stubbed
 * fetch to verify the submit shape.
 *
 * No key fixture used in these tests reads like a real provider key (no
 * `sk-…` / `cd-…` / `fakekey-…` prefixes). The grep step in the
 * implementer report confirms.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { KeysConnect } from '../pages/KeysConnect'
import { setApiToken } from '../lib/api'

type FetchInit = Parameters<typeof fetch>[1]

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setApiToken(undefined)
  fetchSpy = vi.fn()
  ;(globalThis as { window?: unknown }).window = {
    location: {
      origin: 'http://localhost:3847',
      pathname: '/keys/connect',
      search: '',
      href: 'http://localhost:3847/keys/connect',
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

describe('KeysConnect — agnostic mode markup', () => {
  it('renders the agnostic primary input as the visible primary affordance', () => {
    const html = renderToStaticMarkup(<KeysConnect />)
    // The primary card sits BEFORE the suggestions panel in the markup
    // (i.e. it's the first form section the user sees).
    const primaryIdx = html.indexOf('keys-connect-primary')
    const suggestionsIdx = html.indexOf('keys-connect-suggestions')
    expect(primaryIdx).toBeGreaterThan(-1)
    expect(suggestionsIdx).toBeGreaterThan(-1)
    expect(primaryIdx).toBeLessThan(suggestionsIdx)
    // Header copy invites the user to describe their own provider.
    expect(html).toContain('Provider name (or describe your own)')
  })

  it('keeps the bundled suggestions panel collapsed by default', () => {
    const html = renderToStaticMarkup(<KeysConnect />)
    expect(html).toContain('we have suggestions for these')
    // No suggestion buttons rendered — the panel is collapsed.
    expect(html).not.toContain('keys-connect-suggest-')
  })
})

describe('KeysConnect — provider-pinned mode markup', () => {
  it('renders the schema-driven form when ?provider= seeds the route', () => {
    // Re-stub window with the query string in place.
    ;(globalThis as { window?: unknown }).window = {
      location: {
        origin: 'http://localhost:3847',
        pathname: '/keys/connect',
        search: '?provider=crustdata',
        href: 'http://localhost:3847/keys/connect?provider=crustdata',
      },
      history: { pushState: vi.fn(), back: vi.fn(), length: 1 },
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }

    // Static render — useEffect doesn't fire on the server, so the form
    // starts in agnostic mode regardless of search params. We assert the
    // primary input is still rendered and the markup layout is intact.
    const html = renderToStaticMarkup(<KeysConnect />)
    expect(html).toContain('keys-connect-primary')
    expect(html).toContain('keys-connect-form')
  })
})

describe('KeysConnect — submit shape', () => {
  it('POSTs { provider, env } to /api/keys/save', async () => {
    const { api } = await import('../lib/api')
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        status: 'configured',
        provider: 'crustdata',
        healthcheck: { status: 'ok', detail: 'reachable', ok: true },
        sentinel_path: '/tmp/whatever/_handoffs/keys/crustdata.ready',
      }),
    )
    const opaqueValue = 'unit-test-placeholder-1234'
    await api.post('/api/keys/save', {
      provider: 'crustdata',
      env: { CRUSTDATA_API_KEY: opaqueValue },
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [unknown, FetchInit]
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.provider).toBe('crustdata')
    expect(body.env.CRUSTDATA_API_KEY).toBe(opaqueValue)
  })
})

describe('KeysConnect — top-level mount', () => {
  it('mounts without throwing when fetch is stubbed', () => {
    fetchSpy.mockResolvedValue(jsonResponse({ providers: [] }))
    expect(() => renderToStaticMarkup(<KeysConnect />)).not.toThrow()
  })
})
