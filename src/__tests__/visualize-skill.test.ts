/**
 * Tests for the visualize skill + runner.
 *
 * The reasoning capability is mocked at the registry level so each test
 * controls the exact HTML the LLM "returns" — we never actually call
 * Anthropic. The mock also captures the resolved prompt so we can assert
 * that the runner injected brand_tokens + ui-ux-pro-max design directives.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

import { runVisualize } from '../lib/visualize/runner'
import { resetCapabilityRegistry } from '../lib/providers/capabilities'

let TMP: string
let dataPath: string
let capturedPrompts: string[] = []

function makeFakeReasoningAdapter(html: string, idiom: string, summary: string) {
  return {
    capabilityId: 'reasoning' as const,
    providerId: 'anthropic',
    isAvailable: () => true,
    async execute(input: Record<string, unknown>) {
      capturedPrompts.push(String(input.prompt ?? ''))
      const json = { html, idiom, summary, view_id: input.view_id ?? '' }
      return { text: '```json\n' + JSON.stringify(json) + '\n```' }
    },
  }
}

async function installFakeAdapter(html: string, idiom: string, summary: string) {
  const { getCapabilityRegistryReady } = await import('../lib/providers/capabilities')
  const registry = await getCapabilityRegistryReady()
  registry.register(makeFakeReasoningAdapter(html, idiom, summary))
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-viz-skill-'))
  vi.stubEnv('HOME', TMP)
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  capturedPrompts = []
  resetCapabilityRegistry()
  // Seed a small data file under TMP so glob expansion has something to find.
  const runsDir = join(TMP, '.gtm-os', 'agents', 'sample.runs')
  mkdirSync(runsDir, { recursive: true })
  dataPath = join(runsDir, 'run-1.json')
  writeFileSync(
    dataPath,
    JSON.stringify({
      title: 'sample run',
      ranAt: '2026-04-29T10:00:00Z',
      rows: [
        { id: 'a', stage: 'launched', name: 'Sample one' },
        { id: 'b', stage: 'proposed', name: 'Sample two' },
      ],
    }),
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
  resetCapabilityRegistry()
})

describe('visualize skill — happy paths per idiom', () => {
  const idioms: Array<{ idiom: string; html: string; intent: string }> = [
    { idiom: 'kanban', html: '<div class="grid"><div>kanban col</div></div>', intent: 'kanban board of items by stage' },
    { idiom: 'calendar', html: '<div>weekly calendar 7-day grid</div>', intent: 'weekly calendar grid with draft preview' },
    { idiom: 'table', html: '<table><thead><tr><th>id</th></tr></thead></table>', intent: 'sortable table of items' },
    { idiom: 'timeline', html: '<ol><li>2026-04-29 event</li></ol>', intent: 'vertical timeline of events' },
    { idiom: 'cards', html: '<div class="grid"><div>card</div></div>', intent: 'grid of cards with hover lift' },
    { idiom: 'chart', html: '<canvas id="chart"></canvas>', intent: 'chart of trend over time' },
  ]

  for (const { idiom, html, intent } of idioms) {
    it(`produces valid HTML for ${idiom} data shapes`, async () => {
      await installFakeAdapter(html, idiom, `${idiom} of items`)
      const result = await runVisualize({
        view_id: `view-${idiom}`,
        intent,
        data_paths: [dataPath],
      })
      expect(result.idiom).toBe(idiom)
      expect(result.summary).toBe(`${idiom} of items`)
      expect(existsSync(result.page_path)).toBe(true)
      expect(existsSync(result.metadata_path)).toBe(true)
      const written = readFileSync(result.page_path, 'utf-8')
      expect(written).toBe(html)
    })
  }
})

describe('visualize skill — error + idempotency', () => {
  it('errors clearly when data_paths matches no files', async () => {
    await installFakeAdapter('<div>x</div>', 'cards', 'x')
    const missing = join(TMP, '.gtm-os', 'agents', 'no-such.runs', '*.json')
    await expect(
      runVisualize({ view_id: 'no-data', intent: 'cards', data_paths: [missing] }),
    ).rejects.toThrow(/matched no files/)
  })

  it('view_id idempotency — second call overwrites both HTML and sidecar', async () => {
    await installFakeAdapter('<div>v1</div>', 'cards', 'first')
    const a = await runVisualize({
      view_id: 'overwrite-me',
      intent: 'grid of cards',
      data_paths: [dataPath],
    })
    const firstHtml = readFileSync(a.page_path, 'utf-8')
    const firstMeta = JSON.parse(readFileSync(a.metadata_path, 'utf-8'))
    expect(firstHtml).toBe('<div>v1</div>')
    expect(firstMeta.summary).toBe('first')

    // Reset registry and re-install a different adapter response.
    resetCapabilityRegistry()
    await installFakeAdapter('<div>v2</div>', 'cards', 'second')

    // Sleep a tick so last_generated_at definitely changes.
    await new Promise((r) => setTimeout(r, 10))

    const b = await runVisualize({
      view_id: 'overwrite-me',
      intent: 'grid of cards',
      data_paths: [dataPath],
    })
    expect(b.page_path).toBe(a.page_path)
    expect(b.metadata_path).toBe(a.metadata_path)
    const secondHtml = readFileSync(b.page_path, 'utf-8')
    const secondMeta = JSON.parse(readFileSync(b.metadata_path, 'utf-8'))
    expect(secondHtml).toBe('<div>v2</div>')
    expect(secondMeta.summary).toBe('second')
    expect(secondMeta.last_generated_at).not.toBe(firstMeta.last_generated_at)
  })

  it('auto-injects brand_tokens at the runner level — caller never passes them', async () => {
    await installFakeAdapter('<div>x</div>', 'cards', 'x')
    await runVisualize({
      view_id: 'brand-injection',
      intent: 'grid of cards',
      data_paths: [dataPath],
    })
    expect(capturedPrompts.length).toBeGreaterThan(0)
    const prompt = capturedPrompts[0]
    // The brand tokens block always carries the canonical Yalc rose hex.
    expect(prompt).toContain('#C9506E')
    expect(prompt).toContain('#E07A95')
    expect(prompt.toLowerCase()).toContain('outfit')
    expect(prompt.toLowerCase()).toContain('inter')
  })

  it('embeds the ui-ux-pro-max design directives in the LLM prompt', async () => {
    await installFakeAdapter('<div>x</div>', 'kanban', 'x')
    await runVisualize({
      view_id: 'directives-injected',
      intent: 'kanban board of items by stage',
      data_paths: [dataPath],
    })
    const prompt = capturedPrompts[0]
    expect(prompt).toContain('UI/UX Pro Max design directives')
    expect(prompt.toLowerCase()).toContain('palette: yalc rose')
    expect(prompt.toLowerCase()).toContain('forbidden:')
    expect(prompt.toLowerCase()).toContain('bg-blue-')
  })
})
