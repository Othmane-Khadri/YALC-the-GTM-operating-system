/**
 * Tests for /brain edit-in-place (C4).
 *
 * Renders the BrainSectionCard via react-dom/server (no DOM harness), and
 * exercises the API wrapper to verify the POST body matches what the page
 * sends on Save.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { BrainSectionCard } from '../pages/Brain'
import { setApiToken } from '../lib/api'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  setApiToken(undefined)
  fetchSpy = vi.fn()
  ;(globalThis as { window?: unknown }).window = {
    location: { origin: 'http://localhost:3847', pathname: '/brain' },
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
    headers: {
      get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response
}

const baseSection = {
  id: 'icp' as const,
  files: [{ canonical: 'icp/segments.yaml', abs: '/x/icp/segments.yaml', content: 'segments:\n  - name: A\n' }],
  confidence: 0.75,
  confidence_signals: {
    input_chars: 1000,
    llm_self_rating: 7,
    has_metadata_anchors: true,
  },
}

describe('BrainSectionCard render', () => {
  it('shows an Edit button for editable YAML sections in viewing mode', () => {
    const html = renderToStaticMarkup(
      <BrainSectionCard
        section={baseSection}
        edit={null}
        regenBusy={false}
        regenError={null}
        onEnterEdit={() => {}}
        onCancelEdit={() => {}}
        onDraftChange={() => {}}
        onSave={() => {}}
        onRegenerate={() => {}}
      />,
    )
    expect(html).toContain('data-testid="brain-edit-icp"')
    // The pre block surfaces the on-disk content while not editing.
    expect(html).toContain('data-testid="brain-content-icp/segments.yaml"')
  })

  it('hides the Edit button for non-editable sections', () => {
    const html = renderToStaticMarkup(
      <BrainSectionCard
        section={{
          ...baseSection,
          id: 'voice' as const,
          files: [{ canonical: 'voice/tone-of-voice.md', abs: '/x', content: '# tone\n' }],
        }}
        edit={null}
        regenBusy={false}
        regenError={null}
        onEnterEdit={() => {}}
        onCancelEdit={() => {}}
        onDraftChange={() => {}}
        onSave={() => {}}
        onRegenerate={() => {}}
      />,
    )
    expect(html).not.toContain('data-testid="brain-edit-voice"')
  })

  it('renders a textarea + Save + Cancel when in edit mode', () => {
    const html = renderToStaticMarkup(
      <BrainSectionCard
        section={baseSection}
        edit={{ draft: 'segments:\n  - name: B\n', prior: 'segments:\n  - name: A\n', busy: false, error: null }}
        regenBusy={false}
        regenError={null}
        onEnterEdit={() => {}}
        onCancelEdit={() => {}}
        onDraftChange={() => {}}
        onSave={() => {}}
        onRegenerate={() => {}}
      />,
    )
    expect(html).toContain('data-testid="brain-textarea-icp"')
    expect(html).toContain('data-testid="brain-save-icp"')
    expect(html).toContain('data-testid="brain-cancel-icp"')
  })

  it('shows a save error inline when one is set', () => {
    const html = renderToStaticMarkup(
      <BrainSectionCard
        section={baseSection}
        edit={{ draft: '', prior: '', busy: false, error: 'Save blew up' }}
        regenBusy={false}
        regenError={null}
        onEnterEdit={() => {}}
        onCancelEdit={() => {}}
        onDraftChange={() => {}}
        onSave={() => {}}
        onRegenerate={() => {}}
      />,
    )
    expect(html).toContain('data-testid="brain-save-error-icp"')
    expect(html).toContain('Save blew up')
  })
})

describe('Brain section save API wiring', () => {
  it('POSTs to /api/brain/section with { path, value } when saving', async () => {
    const { api } = await import('../lib/api')
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }))
    await api.post('/api/brain/section', {
      path: 'icp.segments[0].name',
      value: 'New name',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [FetchInput, FetchInit]
    expect(String(url)).toContain('/api/brain/section')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      path: 'icp.segments[0].name',
      value: 'New name',
    })
  })
})
