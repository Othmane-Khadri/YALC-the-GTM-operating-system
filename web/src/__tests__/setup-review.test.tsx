/**
 * Tests for the /setup/review SPA page (0.9.B).
 *
 * vitest runs in `node` environment for the rest of the repo (no DOM
 * harness shipped). To keep the test footprint dependency-free, these
 * tests render through `react-dom/server` and walk the produced HTML for
 * structural assertions, then invoke the page's network handlers with
 * stubbed `fetch` to verify the API contract.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SectionCard, SetupReview } from '../pages/SetupReview'
import { setApiToken } from '../lib/api'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setApiToken(undefined)
  fetchSpy = vi.fn()
  // jsdom isn't loaded — stub a window/global enough for `api.ts`.
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: 'http://localhost:3847', pathname: '/setup/review' },
    history: { pushState: vi.fn() },
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

describe('SetupReview structural render', () => {
  it('renders one card per section returned by the API (9 sections)', () => {
    const sections = [
      'company_context',
      'framework',
      'voice',
      'icp',
      'positioning',
      'qualification_rules',
      'campaign_templates',
      'search_queries',
      'config',
    ].map((id) => ({
      id,
      canonical: id === 'voice' ? 'voice/tone-of-voice.md' : `${id}.yaml`,
      content: `# ${id}\n`,
      confidence: 0.7,
      confidence_signals: {
        input_chars: 1200,
        llm_self_rating: 7,
        has_metadata_anchors: true,
      },
    }))
    const html = renderToStaticMarkup(
      <>
        {sections.map((s) => (
          <SectionCard
            key={s.canonical}
            section={s as Parameters<typeof SectionCard>[0]['section']}
            state={{
              content: s.content,
              saved: false,
              dirty: false,
              discard: false,
              error: null,
              busy: false, editing: false,
            }}
            onEdit={() => {}}
            onSave={() => {}}
            onRegenerate={() => {}}
            onToggleDiscard={() => {}}
            onSetEditing={() => {}}
          />
        ))}
      </>,
    )
    // Every section title we picked surfaces at least once.
    expect(html).toContain('Company context')
    expect(html).toContain('GTM framework')
    expect(html).toContain('Voice &amp; tone')
    expect(html).toContain('ICP segments')
    expect(html).toContain('Positioning')
    expect(html).toContain('Qualification rules')
    expect(html).toContain('Campaign templates')
    expect(html).toContain('Search queries')
    expect(html).toContain('Config')
    // 9 confidence badges, one per card.
    const badgeCount = html.match(/data-testid="setup-confidence-/g)?.length ?? 0
    expect(badgeCount).toBe(9)
  })

  it('shows the confidence signals via the badge title attribute', () => {
    const html = renderToStaticMarkup(
      <SectionCard
        section={{
          id: 'framework',
          canonical: 'framework.yaml',
          content: 'a: 1\n',
          confidence: 0.42,
          confidence_signals: {
            input_chars: 321,
            llm_self_rating: 6,
            has_metadata_anchors: false,
          },
        }}
        state={{ content: 'a: 1\n', saved: false, dirty: false, discard: false, error: null, busy: false, editing: false }}
        onEdit={() => {}}
        onSave={() => {}}
        onRegenerate={() => {}}
        onToggleDiscard={() => {}}
            onSetEditing={() => {}}
      />,
    )
    expect(html).toContain('input_chars=321')
    expect(html).toContain('llm_self_rating=6')
    expect(html).toContain('has_metadata_anchors=false')
  })
})

describe('SetupReview API wiring', () => {
  it('the api wrapper PUTs the section content as JSON', async () => {
    const { api } = await import('../lib/api')
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await api.put('/api/setup/preview/framework', {
      content: 'name: x',
      canonical: 'framework.yaml',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit]
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({
      content: 'name: x',
      canonical: 'framework.yaml',
    })
  })

  it('POST /api/setup/commit forwards a discard array', async () => {
    const { api } = await import('../lib/api')
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ ok: true, committed: ['framework.yaml'], discarded: [] }),
    )
    const res = await api.post<{ ok: boolean }>('/api/setup/commit', {
      discard: ['voice'],
    })
    expect(res.ok).toBe(true)
    const [, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit]
    expect(JSON.parse(init?.body as string)).toEqual({ discard: ['voice'] })
  })

  it('POST /api/setup/regenerate/:section calls the right URL', async () => {
    const { api } = await import('../lib/api')
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await api.post('/api/setup/regenerate/voice', {})
    const [url] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit]
    expect(String(url)).toContain('/api/setup/regenerate/voice')
  })
})

describe('SetupReview top-level render', () => {
  it('mounts without throwing when fetch is stubbed', () => {
    fetchSpy.mockResolvedValue(
      jsonResponse({
        tenant: 'default',
        preview_root: '/tmp/.gtm-os/_preview',
        captured_at: null,
        sections: [],
      }),
    )
    expect(() => renderToStaticMarkup(<SetupReview />)).not.toThrow()
  })
})
