#!/usr/bin/env node
/**
 * Cold-start benchmark for the skill-wrapper runtime split.
 *
 * Wave 1 deliverable for the 0.13.0 skill-wrappers plan. Compares two
 * strategies a SKILL.md body can take when wrapping a CLI command:
 *
 *   shell-out      — spawn `npx tsx src/cli/index.ts <cmd>` as a fresh
 *                    Node subprocess. Pays Node + tsx + module-graph
 *                    load on every call. Mirrors what a user sees from
 *                    the CLI directly. Required for SIDE-EFFECTING
 *                    commands (DB writes, API calls, framework state).
 *
 *   import-direct  — import the lib function the CLI command would
 *                    have called and run it in the already-warm Claude
 *                    Code Node process. No subprocess. Only safe for
 *                    PURE commands (registry reads, deterministic
 *                    rule-based generators). The Tier 4 skills
 *                    (`list-adapters`, `show-routine`, `run-doctor`)
 *                    will use this path.
 *
 * Four scenarios, 5 trials each:
 *
 *   A — shell-out, single (`adapters:list --json`)
 *   B — shell-out, chained ×3 (adapters:list, routine:propose, framework:list)
 *   C — import-direct, single (in-process call to runAdaptersList)
 *   D — import-direct, chained ×3 (runAdaptersList + runRoutinePropose + loadAllFrameworks)
 *
 * Output is a min/median/max table per scenario. Numbers feed the
 * "hybrid runtime rule" section of `docs/skills-architecture.md`.
 *
 * Timing: process.hrtime.bigint() throughout. Wall-clock from spawn
 * (or from the in-process call) to exit / return.
 *
 * Decision rule documented in the doc:
 *   - If chained shell-out (Scenario B) median < 500ms, the cold-start
 *     tax is small enough to "always shell out" and skip the hybrid
 *     complexity.
 *   - If chained shell-out (Scenario B) median > 1s, the hybrid split
 *     pays off — keep the import-direct path for Tier 4 quick-reads.
 *   - In between, we keep hybrid for chained Tier 4 reads but shell
 *     out for everything else.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')
const CLI_PATH = resolve(REPO_ROOT, 'src/cli/index.ts')

const TRIALS = 5

/** Run an external command with `npx tsx` and time it from spawn to exit. */
function shellOnce(args) {
  return new Promise((resolveP, rejectP) => {
    const start = process.hrtime.bigint()
    const child = spawn('npx', ['tsx', CLI_PATH, ...args], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    // Drain stdout so the pipe doesn't fill and stall the child.
    child.stdout.on('data', () => {})
    child.on('error', rejectP)
    child.on('close', (code) => {
      const end = process.hrtime.bigint()
      const ms = Number(end - start) / 1e6
      // Non-zero exit is OK for the benchmark — some commands exit 2 when
      // env vars are unset (e.g. routine:propose without ANTHROPIC_API_KEY).
      // We measure cold-start, not success. Surface stderr only on a
      // genuinely catastrophic failure (signal kill).
      if (code === null) {
        rejectP(new Error(`shell command killed by signal: ${stderr.trim().slice(0, 200)}`))
        return
      }
      resolveP({ ms, exitCode: code })
    })
  })
}

/** Trial loop helper — returns ms[]. */
async function trials(label, fn) {
  const samples = []
  for (let i = 0; i < TRIALS; i++) {
    const ms = await fn(i)
    samples.push(ms)
  }
  return { label, samples }
}

/** Scenario A — shell-out, single. */
async function scenarioA() {
  return trials('A: shell-out, single (adapters:list --json)', async () => {
    const r = await shellOnce(['adapters:list', '--json'])
    return r.ms
  })
}

/** Scenario B — shell-out, chained ×3. Sum of three sequential subprocesses. */
async function scenarioB() {
  return trials('B: shell-out, chained x3 (adapters:list + routine:propose + framework:list)', async () => {
    const start = process.hrtime.bigint()
    await shellOnce(['adapters:list', '--json'])
    await shellOnce(['routine:propose', '--json'])
    await shellOnce(['framework:list'])
    const end = process.hrtime.bigint()
    return Number(end - start) / 1e6
  })
}

/**
 * Spawn `npx tsx <inline-script>` and time it from spawn to exit. Mirrors
 * the Pattern B body we ship in Tier 4 SKILL.md files: write a tiny TS
 * snippet that imports the lib function directly, then run it under tsx.
 *
 * The win vs Scenario A/B isn't process startup (still pays Node + tsx
 * boot) — it's avoiding the full Commander program graph. `src/cli/index.ts`
 * pulls in 98 lazy `import` references plus dotenv, plus the diagnostics
 * wrapper. A skill-author entry point only loads the one library subtree
 * it needs.
 */
function tsxScriptOnce(source) {
  return new Promise((resolveP, rejectP) => {
    // Each trial gets its own temp file so module cache between processes
    // is irrelevant — we measure cold-start exactly like a SKILL.md will.
    const tmpFile = resolve(tmpdir(), `yalc-bench-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`)
    writeFileSync(tmpFile, source)
    const start = process.hrtime.bigint()
    const child = spawn('npx', ['tsx', tmpFile], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.stdout.on('data', () => {})
    child.on('error', rejectP)
    child.on('close', (code) => {
      const end = process.hrtime.bigint()
      const ms = Number(end - start) / 1e6
      if (code === null) {
        rejectP(new Error(`tsx script killed by signal: ${stderr.trim().slice(0, 200)}`))
        return
      }
      // Don't fail the bench on non-zero exit (env-driven exit 2 is fine).
      resolveP({ ms, exitCode: code, stderr })
    })
  })
}

/**
 * Scenario C — import-direct, single. Spawns `npx tsx` against an inline
 * script that imports `runAdaptersList` directly and prints the JSON. No
 * Commander, no diagnostics wrapper, no 98-command lazy import wires.
 */
async function scenarioC() {
  const inline = `
import { runAdaptersList } from '${pathToFileURL(resolve(REPO_ROOT, 'src/cli/commands/adapters-list.ts')).href}'
const r = await runAdaptersList({ json: true })
process.stdout.write(r.output + '\\n')
process.exit(r.exitCode)
`
  return trials('C: import-direct, single (runAdaptersList via inline tsx)', async () => {
    const r = await tsxScriptOnce(inline)
    return r.ms
  })
}

/**
 * Scenario D — import-direct, chained ×3. One tsx subprocess loads three
 * lib functions and runs them. This is the "chained Tier 4" case — three
 * read-only commands users want to fire together.
 */
async function scenarioD() {
  const adaptersUrl = pathToFileURL(resolve(REPO_ROOT, 'src/cli/commands/adapters-list.ts')).href
  const routineUrl = pathToFileURL(resolve(REPO_ROOT, 'src/cli/commands/routine.ts')).href
  const loaderUrl = pathToFileURL(resolve(REPO_ROOT, 'src/lib/frameworks/loader.ts')).href
  const inline = `
import { runAdaptersList } from '${adaptersUrl}'
import { runRoutinePropose } from '${routineUrl}'
import { loadAllFrameworks } from '${loaderUrl}'
const a = await runAdaptersList({ json: true })
const b = await runRoutinePropose({ json: true })
const c = loadAllFrameworks()
process.stdout.write(JSON.stringify({ a: a.output.length, b: b.output.length, c: c.length }) + '\\n')
`
  return trials('D: import-direct, chained x3 (single tsx, three imports)', async () => {
    const r = await tsxScriptOnce(inline)
    return r.ms
  })
}

/** min / median / max for a sample array. */
export function summarise(samples) {
  if (!samples.length) return { min: 0, median: 0, max: 0 }
  const sorted = [...samples].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return { min, median, max }
}

/** Render a fixed-width markdown-ish table for the report. */
export function renderTable(rows) {
  const header = ['Scenario', 'min (ms)', 'median (ms)', 'max (ms)', 'samples']
  const widths = header.map((h) => h.length)
  const lines = rows.map((r) => {
    const stats = summarise(r.samples)
    return [
      r.label,
      stats.min.toFixed(1),
      stats.median.toFixed(1),
      stats.max.toFixed(1),
      r.samples.map((s) => s.toFixed(0)).join(','),
    ]
  })
  for (const row of lines) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i], cell.length)
    })
  }
  const sep = '+-' + widths.map((w) => '-'.repeat(w)).join('-+-') + '-+'
  const fmt = (cells) =>
    '| ' + cells.map((c, i) => c.padEnd(widths[i])).join(' | ') + ' |'
  return [sep, fmt(header), sep, ...lines.map(fmt), sep].join('\n')
}

/** Build the structured report (consumed by the test + by docs/). */
export function buildReport(results) {
  return {
    schemaVersion: 1,
    trials: TRIALS,
    timestamp: new Date().toISOString(),
    scenarios: results.map((r) => ({
      label: r.label,
      samplesMs: r.samples,
      ...summarise(r.samples),
    })),
  }
}

/** Decision rule based on Scenario B median. */
export function recommend(report) {
  const b = report.scenarios.find((s) => s.label.startsWith('B:'))
  if (!b) return 'unknown'
  if (b.median < 500) return 'always-shell-out'
  if (b.median > 1000) return 'keep-hybrid'
  return 'hybrid-for-tier4-only'
}

async function main() {
  const reportPath = resolve(REPO_ROOT, 'scripts/.bench-skill-runtime.last.json')
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  const results = []
  if (dryRun) {
    // Smoke path for the test — synthesise samples without spawning anything.
    results.push({ label: 'A: shell-out, single (adapters:list --json)', samples: [100, 110, 105, 120, 95] })
    results.push({ label: 'B: shell-out, chained x3 (adapters:list + routine:propose + framework:list)', samples: [320, 330, 315, 340, 305] })
    results.push({ label: 'C: import-direct, single (runAdaptersList)', samples: [200, 5, 4, 4, 5] })
    results.push({ label: 'D: import-direct, chained x3 (adapters + routine + frameworks)', samples: [220, 8, 7, 7, 9] })
  } else {
    results.push(await scenarioA())
    results.push(await scenarioB())
    results.push(await scenarioC())
    results.push(await scenarioD())
  }

  const table = renderTable(results)
  const report = buildReport(results)
  const recommendation = recommend(report)

  process.stdout.write(table + '\n\n')
  process.stdout.write(`Recommendation: ${recommendation}\n`)
  process.stdout.write(`(B median = ${report.scenarios.find((s) => s.label.startsWith('B:')).median.toFixed(1)}ms — `)
  if (recommendation === 'always-shell-out')
    process.stdout.write('chained shell-out is fast enough; simplify the doc to "always shell out".)\n')
  else if (recommendation === 'keep-hybrid')
    process.stdout.write('chained shell-out is slow; keep hybrid for Tier 4 quick-reads.)\n')
  else
    process.stdout.write('borderline; keep hybrid for Tier 4 chained reads, shell out elsewhere.)\n')

  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  process.stdout.write(`\nWrote ${reportPath}\n`)
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`bench failed: ${err.stack || err.message}\n`)
    process.exit(1)
  })
}
