import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tests for the 0.8.F doctor preview-confidence layer.
 *
 * We exercise the layer directly via the internal helper exported by
 * doctor.ts — running the full `runDoctor` would require a stubbed
 * environment and SQLite, which is overkill for confidence-only checks.
 * Each test stubs HOME so the layer reads from a sandboxed _preview/.
 */

let TMP: string

function writeMeta(home: string, sections: Record<string, { confidence: number; chars?: number }>) {
  const previewDir = join(home, '.gtm-os', '_preview')
  mkdirSync(previewDir, { recursive: true })
  const meta = {
    captured_at: '2026-04-27T00:00:00Z',
    version: '0.6.0',
    sections: Object.fromEntries(
      Object.entries(sections).map(([name, v]) => [
        name,
        {
          confidence: v.confidence,
          confidence_signals: {
            input_chars: v.chars ?? 0,
            llm_self_rating: 5,
            has_metadata_anchors: false,
          },
        },
      ]),
    ),
  }
  writeFileSync(join(previewDir, '_meta.json'), JSON.stringify(meta, null, 2))
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-doctor-conf-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

/**
 * We can't directly import the unexported `previewConfidenceLayer` —
 * instead we run `runDoctor` with stdout captured and assert on the
 * surfaced output. To avoid running real network probes / SQLite, the
 * tests stub all process side-effects and rely on the layer-emission
 * order: doctor prints the "── Preview Confidence ──" header right after
 * the Configuration layer.
 */
async function runDoctorCapture(): Promise<string> {
  const original = console.log
  const buffer: string[] = []
  console.log = (...args: unknown[]) => {
    buffer.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
  }
  // Doctor calls process.exit on FAIL; intercept so the test runner
  // doesn't tear down. We only care about stdout.
  const realExit = process.exit
  ;(process as unknown as { exit: (code?: number) => void }).exit = ((_code?: number) => {
    /* noop in tests */
  }) as never
  try {
    const { runDoctor } = await import('../lib/diagnostics/doctor')
    await runDoctor({ report: false })
  } finally {
    console.log = original
    ;(process as unknown as { exit: typeof realExit }).exit = realExit
  }
  return buffer.join('\n')
}

describe('doctor confidence layer', () => {
  it('emits the Preview Confidence header when meta.sections is populated', async () => {
    writeMeta(TMP, {
      framework: { confidence: 0.9, chars: 5000 },
      voice: { confidence: 0.92, chars: 1200 },
      icp: { confidence: 0.7, chars: 800 },
    })
    const out = await runDoctorCapture()
    expect(out).toContain('── Preview Confidence ──')
    expect(out).toContain('Preview confidence — 2 high')
    expect(out).toContain('1 medium')
    expect(out).toContain('0 low')
  })

  it('omits the layer when no preview folder exists', async () => {
    // No writeMeta — preview folder absent.
    const out = await runDoctorCapture()
    expect(out).not.toContain('── Preview Confidence ──')
  })

  it('lists low-confidence sections with an actionable hint', async () => {
    writeMeta(TMP, {
      framework: { confidence: 0.9, chars: 5000 },
      icp: { confidence: 0.42, chars: 218 },
      voice: { confidence: 0.51, chars: 340 },
    })
    const out = await runDoctorCapture()
    expect(out).toContain('Low-confidence section: icp')
    expect(out).toContain('Low-confidence section: voice')
    expect(out).toContain('confidence 0.42')
    expect(out).toContain('218 chars')
    expect(out).toContain('confidence 0.51')
    expect(out).toContain('340 chars')
    // The icp suggestion mentions --icp-summary or --docs.
    expect(out).toMatch(/icp-summary|--docs/)
  })

  it('treats 0.6 as the medium/low boundary (default threshold)', async () => {
    writeMeta(TMP, {
      framework: { confidence: 0.6, chars: 1000 }, // medium edge — not low
      icp: { confidence: 0.59, chars: 1000 }, // low — just under
    })
    const out = await runDoctorCapture()
    // 0.6 belongs in `medium` per the heuristic (>=0.6 AND <0.85).
    expect(out).toContain('1 medium')
    expect(out).toContain('1 low')
    // Only the section under 0.6 surfaces as a low-confidence WARN.
    expect(out).toContain('Low-confidence section: icp')
    expect(out).not.toContain('Low-confidence section: framework')
  })
})
