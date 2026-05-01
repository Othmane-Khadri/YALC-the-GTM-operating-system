/**
 * Tests for the /dashboard/<archetype> SPA pages and the /today archetype
 * redirect (C3).
 *
 * The four archetype dashboards live at /dashboard/a..d. When the user has
 * pinned an archetype in `~/.gtm-os/config.yaml` (surfaced through the
 * /api/dashboard/list payload that the SPA consults on /today entry), the
 * router navigates them to /dashboard/<archetype> instead of rendering the
 * shared /today feed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App'
import { Dashboard } from '../pages/Dashboard'
import { setApiToken } from '../lib/api'

let fetchSpy: ReturnType<typeof vi.fn>
let pushStateSpy: ReturnType<typeof vi.fn>
let replaceStateSpy: ReturnType<typeof vi.fn>

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    headers: {
      get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

function stubWindow(pathname: string) {
  pushStateSpy = vi.fn()
  replaceStateSpy = vi.fn()
  ;(globalThis as { window?: unknown }).window = {
    location: {
      origin: 'http://localhost:3847',
      pathname,
      search: '',
      href: `http://localhost:3847${pathname}`,
      assign: vi.fn(),
      replace: vi.fn(),
    },
    history: {
      pushState: pushStateSpy,
      replaceState: replaceStateSpy,
      back: vi.fn(),
      length: 1,
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

beforeEach(() => {
  setApiToken(undefined)
  fetchSpy = vi.fn()
  ;(globalThis as { fetch?: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
  delete (globalThis as { fetch?: typeof fetch }).fetch
  vi.restoreAllMocks()
})

describe('App router — /dashboard/<archetype>', () => {
  it('mounts the Dashboard page when the path matches', () => {
    stubWindow('/dashboard/c')
    fetchSpy.mockResolvedValue(jsonResponse({}))
    const html = renderToStaticMarkup(<App />)
    // The Dashboard page tags itself with a stable testid root we can grep.
    expect(html).toContain('dashboard-page')
    expect(html).toContain('archetype-c')
  })

  it('mounts the Dashboard page for each of the four archetype letters', () => {
    fetchSpy.mockResolvedValue(jsonResponse({}))
    for (const id of ['a', 'b', 'c', 'd']) {
      stubWindow(`/dashboard/${id}`)
      const html = renderToStaticMarkup(<App />)
      expect(html).toContain(`archetype-${id}`)
    }
  })
})

describe('Dashboard page — markup contract', () => {
  it('exposes a Switch dashboard control listing peer archetypes', () => {
    stubWindow('/dashboard/a')
    fetchSpy.mockResolvedValue(jsonResponse({}))
    const html = renderToStaticMarkup(<Dashboard archetypeId="a" />)
    expect(html).toContain('dashboard-switcher')
    // Each archetype letter appears as a switcher option.
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(html).toContain(`dashboard-switch-${id}`)
    }
  })
})

describe('App router — /today archetype redirect', () => {
  it('navigates to /dashboard/<archetype> when the active archetype is pinned', async () => {
    stubWindow('/today')
    // Prime the call the SPA makes to discover the pinned archetype.
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/dashboard/active')) {
        return jsonResponse({ archetype: 'b' })
      }
      return jsonResponse({})
    })
    const { resolveTodayRedirect } = await import('../lib/dashboard-redirect')
    const target = await resolveTodayRedirect()
    expect(target).toBe('/dashboard/b')
  })

  it('falls back to /today when no archetype has been pinned', async () => {
    stubWindow('/today')
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/api/dashboard/active')) {
        return jsonResponse({ archetype: null })
      }
      return jsonResponse({})
    })
    const { resolveTodayRedirect } = await import('../lib/dashboard-redirect')
    const target = await resolveTodayRedirect()
    expect(target).toBeNull()
  })

  it('falls back to /today when the lookup fails', async () => {
    stubWindow('/today')
    fetchSpy.mockResolvedValue(jsonResponse({ error: 'boom' }, 500))
    const { resolveTodayRedirect } = await import('../lib/dashboard-redirect')
    const target = await resolveTodayRedirect()
    expect(target).toBeNull()
  })
})
