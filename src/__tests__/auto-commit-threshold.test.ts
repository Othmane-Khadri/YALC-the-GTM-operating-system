import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yaml from 'js-yaml'

import {
  classifyPreviewSections,
  resolveEffectiveThreshold,
  readConfigAutoCommitThreshold,
  applyAutoCommit,
  DEFAULT_AUTO_COMMIT_THRESHOLD,
  NO_AUTO_COMMIT_THRESHOLD,
} from '../lib/onboarding/auto-commit'
import { writePreviewMeta, ensurePreviewDir } from '../lib/onboarding/preview'

describe('0.9.F auto-commit threshold', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-autoc-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    mkdirSync(join(tempHome, '.gtm-os'), { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('high-confidence sections auto-commit; low-confidence sections queue', () => {
    const decisions = classifyPreviewSections({
      voice: { confidence: 0.9 },
      icp: { confidence: 0.5 },
      positioning: { confidence: 0.86 },
      framework: { confidence: 0.84 },
    })
    const auto = decisions.filter((d) => d.auto_committed).map((d) => d.section).sort()
    const queued = decisions.filter((d) => !d.auto_committed).map((d) => d.section).sort()
    expect(auto).toEqual(['positioning', 'voice'])
    expect(queued).toEqual(['framework', 'icp'])
  })

  it('--no-auto-commit forces every section into the review queue', () => {
    const threshold = resolveEffectiveThreshold({ noAutoCommit: true })
    expect(threshold).toBe(NO_AUTO_COMMIT_THRESHOLD)
    const decisions = classifyPreviewSections(
      { voice: { confidence: 0.99 }, icp: { confidence: 1 } },
      { noAutoCommit: true },
    )
    expect(decisions.every((d) => !d.auto_committed)).toBe(true)
  })

  it('config.yaml `onboarding.auto_commit_threshold` is respected', () => {
    const cfgPath = join(tempHome, '.gtm-os', 'config.yaml')
    writeFileSync(cfgPath, yaml.dump({ onboarding: { auto_commit_threshold: 0.95 } }))
    expect(readConfigAutoCommitThreshold()).toBeCloseTo(0.95)
    const threshold = resolveEffectiveThreshold()
    expect(threshold).toBeCloseTo(0.95)
    const decisions = classifyPreviewSections({ voice: { confidence: 0.9 }, icp: { confidence: 0.96 } })
    const auto = decisions.filter((d) => d.auto_committed).map((d) => d.section)
    expect(auto).toEqual(['icp'])
  })

  it('--auto-commit-threshold flag takes precedence over config + default', () => {
    const cfgPath = join(tempHome, '.gtm-os', 'config.yaml')
    writeFileSync(cfgPath, yaml.dump({ onboarding: { auto_commit_threshold: 0.95 } }))
    const threshold = resolveEffectiveThreshold({ threshold: 0.5 })
    expect(threshold).toBe(0.5)
    expect(DEFAULT_AUTO_COMMIT_THRESHOLD).toBeCloseTo(0.85)
  })

  it('applyAutoCommit moves high-confidence files to live and leaves low-confidence in preview', async () => {
    // Stage two preview sections — voice (high) + icp (low).
    const tenant = { tenantId: 'default' }
    const { previewPath } = await import('../lib/onboarding/preview')
    ensurePreviewDir('voice/tone-of-voice.md', tenant)
    ensurePreviewDir('icp/segments.yaml', tenant)
    writeFileSync(previewPath('voice/tone-of-voice.md', tenant), '# Voice doc')
    writeFileSync(previewPath('icp/segments.yaml', tenant), 'segments: []\n')

    writePreviewMeta(
      {
        captured_at: new Date().toISOString(),
        sections: {
          voice: {
            confidence: 0.92,
            confidence_signals: { input_chars: 5000, llm_self_rating: 9, has_metadata_anchors: true },
          },
          icp: {
            confidence: 0.4,
            confidence_signals: { input_chars: 100, llm_self_rating: 4, has_metadata_anchors: false },
          },
        },
      },
      tenant,
    )

    const result = await applyAutoCommit(tenant, { threshold: 0.85 })
    expect(result.committed).toContain('voice')
    expect(result.queued).toContain('icp')

    // Live tree now has voice; preview still has icp.
    const livePath = join(tempHome, '.gtm-os', 'voice', 'tone-of-voice.md')
    expect(existsSync(livePath)).toBe(true)
    expect(existsSync(previewPath('voice/tone-of-voice.md', tenant))).toBe(false)
    expect(existsSync(previewPath('icp/segments.yaml', tenant))).toBe(true)
  })
})
