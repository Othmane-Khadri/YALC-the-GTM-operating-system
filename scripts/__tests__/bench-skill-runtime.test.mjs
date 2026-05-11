/**
 * Tests for `scripts/bench-skill-runtime.mjs`.
 *
 * The actual measurements vary by machine and load — we don't assert on
 * them. We assert:
 *
 *   1. `summarise()` returns correct min/median/max for known input.
 *   2. `renderTable()` returns a non-empty string with the scenario label.
 *   3. `buildReport()` produces the schema `docs/skills-architecture.md`
 *      embeds (schemaVersion, trials, timestamp, scenarios[].{label,
 *      samplesMs, min, median, max}). If this drifts, the doc copy block
 *      and the report consumer drift in lockstep.
 *   4. `recommend()` returns one of the three documented strings based
 *      on Scenario B's median.
 *   5. The script runs end-to-end in --dry-run mode without crashing
 *      (smokes the spawn-free path).
 */

import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  summarise,
  renderTable,
  buildReport,
  recommend,
} from '../bench-skill-runtime.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SCRIPT_PATH = resolve(__dirname, '..', 'bench-skill-runtime.mjs')

describe('bench-skill-runtime: summarise()', () => {
  it('returns correct min/median/max for an odd-length sample', () => {
    const r = summarise([10, 20, 30, 40, 50])
    expect(r.min).toBe(10)
    expect(r.median).toBe(30)
    expect(r.max).toBe(50)
  })

  it('averages the two middle values for an even-length sample', () => {
    const r = summarise([10, 20, 30, 40])
    expect(r.median).toBe(25)
  })

  it('returns zeros on empty input', () => {
    expect(summarise([])).toEqual({ min: 0, median: 0, max: 0 })
  })

  it('does not mutate the input array', () => {
    const samples = [50, 10, 30]
    summarise(samples)
    expect(samples).toEqual([50, 10, 30])
  })
})

describe('bench-skill-runtime: renderTable()', () => {
  it('produces a string containing every scenario label', () => {
    const rows = [
      { label: 'A: shell-out, single', samples: [100, 110, 105, 120, 95] },
      { label: 'B: shell-out, chained', samples: [320, 330, 315, 340, 305] },
    ]
    const table = renderTable(rows)
    expect(table).toContain('A: shell-out, single')
    expect(table).toContain('B: shell-out, chained')
    expect(table).toContain('min (ms)')
    expect(table).toContain('median (ms)')
    expect(table).toContain('max (ms)')
  })
})

describe('bench-skill-runtime: buildReport() schema', () => {
  it('matches the shape docs/skills-architecture.md embeds', () => {
    const rows = [
      { label: 'A: shell-out, single (adapters:list --json)', samples: [100, 110, 105, 120, 95] },
      { label: 'B: shell-out, chained x3', samples: [320, 330, 315, 340, 305] },
      { label: 'C: import-direct, single', samples: [200, 5, 4, 4, 5] },
      { label: 'D: import-direct, chained x3', samples: [220, 8, 7, 7, 9] },
    ]
    const report = buildReport(rows)
    expect(report.schemaVersion).toBe(1)
    expect(typeof report.trials).toBe('number')
    expect(typeof report.timestamp).toBe('string')
    expect(Array.isArray(report.scenarios)).toBe(true)
    expect(report.scenarios.length).toBe(4)

    for (const s of report.scenarios) {
      expect(typeof s.label).toBe('string')
      expect(Array.isArray(s.samplesMs)).toBe(true)
      expect(typeof s.min).toBe('number')
      expect(typeof s.median).toBe('number')
      expect(typeof s.max).toBe('number')
    }

    // Sanity: each scenario label is anchored by its prefix so the doc
    // can match `s.label.startsWith('B:')` reliably.
    const prefixes = report.scenarios.map((s) => s.label.charAt(0))
    expect(prefixes).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('bench-skill-runtime: recommend()', () => {
  it('recommends "always-shell-out" when chained shell-out is fast', () => {
    const rows = [
      { label: 'A: shell-out, single', samples: [100] },
      { label: 'B: shell-out, chained x3', samples: [200, 210, 220, 215, 205] },
      { label: 'C: import-direct, single', samples: [50] },
      { label: 'D: import-direct, chained x3', samples: [80] },
    ]
    expect(recommend(buildReport(rows))).toBe('always-shell-out')
  })

  it('recommends "keep-hybrid" when chained shell-out is slow', () => {
    const rows = [
      { label: 'A: shell-out, single', samples: [800] },
      { label: 'B: shell-out, chained x3', samples: [2500, 2600, 2400, 2700, 2550] },
      { label: 'C: import-direct, single', samples: [700] },
      { label: 'D: import-direct, chained x3', samples: [1300] },
    ]
    expect(recommend(buildReport(rows))).toBe('keep-hybrid')
  })

  it('recommends the borderline option in the 500ms-1s range', () => {
    const rows = [
      { label: 'A: shell-out, single', samples: [300] },
      { label: 'B: shell-out, chained x3', samples: [700, 750, 720, 740, 730] },
      { label: 'C: import-direct, single', samples: [200] },
      { label: 'D: import-direct, chained x3', samples: [350] },
    ]
    expect(recommend(buildReport(rows))).toBe('hybrid-for-tier4-only')
  })
})

describe('bench-skill-runtime: --dry-run end-to-end', () => {
  it('runs without crashing and writes the JSON report', () => {
    // --dry-run uses synthesised samples — does not spawn npx tsx — so
    // this test is fast and deterministic. We just confirm the script's
    // top-level wiring (CLI parse -> render -> writeFileSync) holds.
    const result = spawnSync('node', [SCRIPT_PATH, '--dry-run'], {
      cwd: resolve(__dirname, '..', '..'),
      encoding: 'utf8',
      timeout: 15000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Recommendation:')
    expect(result.stdout).toContain('A: shell-out, single')
    expect(result.stdout).toContain('Wrote ')
  })
})
