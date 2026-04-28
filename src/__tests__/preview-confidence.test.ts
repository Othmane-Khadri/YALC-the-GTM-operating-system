import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the 0.8.F preview confidence layer:
 *   1. `computeConfidence` heuristic — bounds + 0.4/0.4/0.2 weighting.
 *   2. Per-section confidence written into `_preview/_meta.json`.
 *   3. `__yalc_confidence` self-rating parsing + stripping.
 *   4. `has_metadata_anchors` derived from auto-extract output.
 *
 * Tests stub HOME so synthesis writes into a sandboxed `_preview/` and never
 * touches the developer's real `~/.gtm-os/`.
 */

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-confidence-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  // Force the stub-body code path — keeps these tests deterministic and
  // free of network calls. Individual tests that exercise the LLM path
  // mock `runSectionPrompt` via vi.doMock instead.
  delete process.env.ANTHROPIC_API_KEY
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('../lib/framework/section-prompts/index.js')
  rmSync(TMP, { recursive: true, force: true })
})

describe('computeConfidence heuristic', () => {
  it('returns 0 for empty/zero signals', async () => {
    const { computeConfidence } = await import('../lib/onboarding/confidence')
    const score = computeConfidence({
      input_chars: 0,
      llm_self_rating: 0,
      has_metadata_anchors: false,
    })
    expect(score).toBe(0)
  })

  it('returns 1 for fully-saturated signals', async () => {
    const { computeConfidence } = await import('../lib/onboarding/confidence')
    const score = computeConfidence({
      input_chars: 5000,
      llm_self_rating: 10,
      has_metadata_anchors: true,
    })
    expect(score).toBe(1)
    // Past saturation still caps at 1 — guards against runaway scores.
    expect(
      computeConfidence({
        input_chars: 50_000,
        llm_self_rating: 10,
        has_metadata_anchors: true,
      }),
    ).toBe(1)
  })

  it('applies the 0.4/0.4/0.2 weighting correctly', async () => {
    const { computeConfidence } = await import('../lib/onboarding/confidence')
    // 2500 chars (50% saturated) + rating 5 (50%) + anchors=true (1) =>
    // 0.4*0.5 + 0.4*0.5 + 0.2*1 = 0.2 + 0.2 + 0.2 = 0.6.
    const score = computeConfidence({
      input_chars: 2500,
      llm_self_rating: 5,
      has_metadata_anchors: true,
    })
    expect(score).toBeCloseTo(0.6, 5)

    // anchors=false drops the bonus: 0.4*1 + 0.4*0.8 + 0 = 0.72.
    const noAnchor = computeConfidence({
      input_chars: 5000,
      llm_self_rating: 8,
      has_metadata_anchors: false,
    })
    expect(noAnchor).toBeCloseTo(0.72, 5)
  })
})

describe('synthesis writes per-section confidence to _meta.json', () => {
  it('writes confidence + signals for every synthesized section', async () => {
    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')
    const ctx = emptyCompanyContext()
    ctx.company.name = 'TestCo'

    await writeSynthesizedPreview({
      context: ctx,
      rawSources: { website: 'a'.repeat(2500) },
      hasMetadataAnchors: true,
    })

    const metaPath = previewPath('_meta.json')
    expect(existsSync(metaPath)).toBe(true)
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
    expect(meta.sections).toBeDefined()

    // Each synthesized section gets an entry with confidence + signals.
    for (const section of [
      'framework',
      'voice',
      'icp',
      'positioning',
      'qualification_rules',
      'campaign_templates',
      'search_queries',
    ]) {
      expect(meta.sections[section]).toBeDefined()
      expect(typeof meta.sections[section].confidence).toBe('number')
      expect(meta.sections[section].confidence).toBeGreaterThanOrEqual(0)
      expect(meta.sections[section].confidence).toBeLessThanOrEqual(1)
      expect(meta.sections[section].confidence_signals).toMatchObject({
        input_chars: expect.any(Number),
        llm_self_rating: expect.any(Number),
        has_metadata_anchors: expect.any(Boolean),
      })
    }
  })
})

describe('__yalc_confidence field handling', () => {
  it('records the LLM self-rating when the model emits a valid value', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    vi.doMock('../lib/framework/section-prompts/index.js', async () => {
      const actual = await vi.importActual<typeof import('../lib/framework/section-prompts/index.js')>(
        '../lib/framework/section-prompts/index.js',
      )
      return {
        ...actual,
        runSectionPrompt: vi.fn(async () => 'a: 1\n__yalc_confidence: 8\n'),
      }
    })

    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')

    await writeSynthesizedPreview({
      context: emptyCompanyContext(),
      rawSources: { website: 'a'.repeat(5000) },
      hasMetadataAnchors: false,
      only: ['framework'],
    })

    const meta = JSON.parse(readFileSync(previewPath('_meta.json'), 'utf-8'))
    expect(meta.sections.framework.confidence_signals.llm_self_rating).toBe(8)
    // 5000 chars saturates (1.0) + rating 8/10 (0.8) + no anchors:
    //   0.4 + 0.32 + 0 = 0.72
    expect(meta.sections.framework.confidence).toBeCloseTo(0.72, 5)
  })

  it('falls back to default rating 5 when the field is missing', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    vi.doMock('../lib/framework/section-prompts/index.js', async () => {
      const actual = await vi.importActual<typeof import('../lib/framework/section-prompts/index.js')>(
        '../lib/framework/section-prompts/index.js',
      )
      return {
        ...actual,
        runSectionPrompt: vi.fn(async () => 'a: 1\n'),
      }
    })

    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')

    await writeSynthesizedPreview({
      context: emptyCompanyContext(),
      rawSources: { website: 'a'.repeat(2500) },
      hasMetadataAnchors: false,
      only: ['framework'],
    })

    const meta = JSON.parse(readFileSync(previewPath('_meta.json'), 'utf-8'))
    expect(meta.sections.framework.confidence_signals.llm_self_rating).toBe(5)
  })

  it('strips the confidence field from the live preview body', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key'
    vi.doMock('../lib/framework/section-prompts/index.js', async () => {
      const actual = await vi.importActual<typeof import('../lib/framework/section-prompts/index.js')>(
        '../lib/framework/section-prompts/index.js',
      )
      return {
        ...actual,
        runSectionPrompt: vi.fn(async () => 'company:\n  name: TestCo\n__yalc_confidence: 7\n'),
      }
    })

    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')

    await writeSynthesizedPreview({
      context: emptyCompanyContext(),
      rawSources: { website: 'a'.repeat(2500) },
      only: ['framework'],
    })

    const body = readFileSync(previewPath('framework.yaml'), 'utf-8')
    expect(body).not.toContain('__yalc_confidence')
    expect(body).toContain('TestCo')
  })

  it('parseConfidenceField is tolerant of malformed values', async () => {
    const { parseConfidenceField } = await import('../lib/framework/section-prompts/index')
    expect(parseConfidenceField('hello world').rating).toBeNull()
    expect(parseConfidenceField('body\n__yalc_confidence: not-a-number\n').rating).toBeNull()
    // Out-of-range values clamp to [0, 10].
    expect(parseConfidenceField('body\n__yalc_confidence: 99\n').rating).toBe(10)
    // Decimal ratings preserved.
    expect(parseConfidenceField('body\n__yalc_confidence: 7.5\n').rating).toBe(7.5)
  })
})

describe('has_metadata_anchors signal', () => {
  it('is true when website auto-extract found rich meta tags', async () => {
    const { hasMetadataAnchors } = await import('../lib/onboarding/auto-extract')
    const html =
      '<html><head><meta property="og:site_name" content="ExampleCo">' +
      '<meta name="description" content="We do stuff."></head><body><p>...</p></body></html>'
    expect(hasMetadataAnchors(html)).toBe(true)

    // Bare HTML with no anchors at all → false.
    const bare = '<html><body><p>plain text only</p></body></html>'
    expect(hasMetadataAnchors(bare)).toBe(false)
  })

  it('feeds through synthesis into the per-section meta entry', async () => {
    const { writeSynthesizedPreview } = await import('../lib/onboarding/synthesis')
    const { previewPath } = await import('../lib/onboarding/preview')
    const { emptyCompanyContext } = await import('../lib/framework/context-types')

    await writeSynthesizedPreview({
      context: emptyCompanyContext(),
      rawSources: { website: 'a'.repeat(1000), voice: 'sample' },
      hasMetadataAnchors: true,
      only: ['framework', 'voice'],
    })

    const meta = JSON.parse(readFileSync(previewPath('_meta.json'), 'utf-8'))
    // Framework benefits from the anchor.
    expect(meta.sections.framework.confidence_signals.has_metadata_anchors).toBe(true)
    // Voice doesn't draw on website meta tags — anchors don't apply.
    expect(meta.sections.voice.confidence_signals.has_metadata_anchors).toBe(false)
  })
})
