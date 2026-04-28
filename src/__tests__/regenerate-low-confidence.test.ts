import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

/**
 * Tests for `start --regenerate-low-confidence` (0.8.F).
 *
 * The flag is glue over the existing `--regenerate <section>` plumbing:
 * scan `_preview/_meta.json`, pick sections below the threshold, and
 * call the synthesis runner once per match. We mock the synthesis layer
 * so the tests never reach the LLM.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-rlc-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  delete process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key' // avoids the "needs an Anthropic key" branch
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('../lib/onboarding/synthesis.js')
  rmSync(TMP, { recursive: true, force: true })
})

interface Seed {
  sections: Record<string, number>
}

function seedPreview(home: string, seed: Seed) {
  const previewDir = join(home, '.gtm-os', '_preview')
  mkdirSync(previewDir, { recursive: true })
  // Minimal company_context.yaml so runRegenerateSection's parse step
  // succeeds. We don't need real fields — synthesis is mocked.
  writeFileSync(
    join(previewDir, 'company_context.yaml'),
    yaml.dump({
      meta: { captured_at: '2026-04-27T00:00:00Z', version: '0.6.0' },
      company: { name: 'TestCo' },
      icp: { competitors: [], pain_points: [] },
      voice: {},
      sources: {},
      founder: {},
    }),
  )
  const meta = {
    captured_at: '2026-04-27T00:00:00Z',
    version: '0.6.0',
    sections: Object.fromEntries(
      Object.entries(seed.sections).map(([name, conf]) => [
        name,
        {
          confidence: conf,
          confidence_signals: {
            input_chars: 500,
            llm_self_rating: 5,
            has_metadata_anchors: false,
          },
        },
      ]),
    ),
  }
  writeFileSync(join(previewDir, '_meta.json'), JSON.stringify(meta, null, 2))
}

async function loadStartWithMockSynthesis(): Promise<{
  runStart: typeof import('../lib/onboarding/start').runStart
  spy: ReturnType<typeof vi.fn>
}> {
  const spy = vi.fn(async (opts: { only?: string[] }) => ({
    written: opts.only ?? [],
    sections: opts.only ?? [],
    llmDriven: true,
  }))
  vi.doMock('../lib/onboarding/synthesis.js', async () => {
    const actual = await vi.importActual<typeof import('../lib/onboarding/synthesis.js')>(
      '../lib/onboarding/synthesis.js',
    )
    return {
      ...actual,
      writeSynthesizedPreview: spy,
    }
  })
  const { runStart } = await import('../lib/onboarding/start')
  return { runStart, spy }
}

describe('start --regenerate-low-confidence', () => {
  it('discovers sections below the default 0.6 threshold and regenerates each', async () => {
    seedPreview(TMP, {
      sections: {
        framework: 0.9,
        voice: 0.42,
        icp: 0.55,
        positioning: 0.7,
      },
    })
    const { runStart, spy } = await loadStartWithMockSynthesis()

    await runStart({
      tenantId: 'default',
      regenerateLowConfidence: true,
    })

    // Exactly the two below-threshold sections are regenerated.
    expect(spy).toHaveBeenCalledTimes(2)
    const calledSections = spy.mock.calls
      .map((call) => (call[0] as { only?: string[] }).only?.[0])
      .filter(Boolean)
      .sort()
    expect(calledSections).toEqual(['icp', 'voice'])
  })

  it('respects a custom --confidence-threshold value', async () => {
    seedPreview(TMP, {
      sections: {
        framework: 0.9,
        voice: 0.7,
        icp: 0.55,
      },
    })
    const { runStart, spy } = await loadStartWithMockSynthesis()

    // Threshold 0.8 — voice (0.7) and icp (0.55) qualify.
    await runStart({
      tenantId: 'default',
      regenerateLowConfidence: true,
      confidenceThreshold: 0.8,
    })

    expect(spy).toHaveBeenCalledTimes(2)
    const sections = spy.mock.calls
      .map((c) => (c[0] as { only?: string[] }).only?.[0])
      .sort()
    expect(sections).toEqual(['icp', 'voice'])
  })

  it('is a no-op when every section is above threshold', async () => {
    seedPreview(TMP, {
      sections: {
        framework: 0.95,
        voice: 0.88,
        icp: 0.9,
      },
    })
    const { runStart, spy } = await loadStartWithMockSynthesis()

    await runStart({
      tenantId: 'default',
      regenerateLowConfidence: true,
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it('dispatches calls in order of ascending confidence (worst first)', async () => {
    seedPreview(TMP, {
      sections: {
        framework: 0.55,
        voice: 0.2,
        icp: 0.5,
      },
    })
    const { runStart, spy } = await loadStartWithMockSynthesis()

    await runStart({
      tenantId: 'default',
      regenerateLowConfidence: true,
    })

    const ordered = spy.mock.calls.map((c) => (c[0] as { only?: string[] }).only?.[0])
    expect(ordered).toEqual(['voice', 'icp', 'framework'])
  })
})
