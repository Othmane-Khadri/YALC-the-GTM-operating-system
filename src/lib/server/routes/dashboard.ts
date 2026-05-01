/**
 * /api/dashboard/:archetype — archetype-specific dashboard data (C3).
 *
 * Each of the four owner archetypes (a/b/c/d) gets its own first-class
 * dashboard route. The payload is an opinionated, scoped slice of the
 * data /today aggregates across every framework — same disk layout,
 * filtered to the single framework that archetype owns.
 *
 * Response shape:
 *
 *   {
 *     archetype: { id, framework, title, description },
 *     installed: boolean,
 *     active_runs: number,                // run JSON files on disk
 *     last_successful_pass: string | null, // ISO timestamp of newest run.error == null
 *     awaiting_gates: GateItem[],         // filtered to this archetype's framework
 *     recent_runs: RunItem[],             // newest 10 runs for this framework
 *     visualizations: Array<{ view_id, intent, generated, last_generated_at: string|null }>,
 *   }
 *
 * Read-only — no writes happen here. The route lives alongside /today so
 * SPA pages can summon archetype-pinned views without re-implementing
 * the disk walk.
 */

import { Hono } from 'hono'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { findArchetype, ARCHETYPES } from '../../frameworks/archetypes.js'
import { readArchetypePreference } from '../../config/archetype-pref.js'
import { findFramework } from '../../frameworks/loader.js'
import { listInstalledFrameworks } from '../../frameworks/registry.js'
import {
  enforceGateTimeouts,
  isGateStale,
  isGateTimedOut,
  resolveGateTimeoutHours,
} from '../../frameworks/gate-timeouts.js'
import {
  listVisualizations,
  readVisualizationMetadata,
} from '../../visualize/storage.js'

export const dashboardRoutes = new Hono()

const RECENT_RUNS_LIMIT = 10

interface RunRecord {
  ranAt: string
  title: string
  summary: string
  rowCount: number
  error: string | null
  path: string
}

interface AwaitingGate {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  created_at: string
  timeout_hours: number
  stale: boolean
}

function agentsDir(): string {
  return join(homedir(), '.gtm-os', 'agents')
}

function discoverRunsForFramework(framework: string): RunRecord[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const candidates: string[] = []
  // Layout A — `<framework>.runs/`
  const layoutA = join(root, `${framework}.runs`)
  if (existsSync(layoutA) && statSync(layoutA).isDirectory()) {
    for (const f of readdirSync(layoutA)) {
      if (!isPlainRunFile(f)) continue
      candidates.push(join(layoutA, f))
    }
  }
  // Layout B — `<framework>/runs/`
  const layoutB = join(root, framework, 'runs')
  if (existsSync(layoutB) && statSync(layoutB).isDirectory()) {
    for (const f of readdirSync(layoutB)) {
      if (!isPlainRunFile(f)) continue
      candidates.push(join(layoutB, f))
    }
  }
  const out: RunRecord[] = []
  for (const abs of candidates) {
    const rec = readRunFile(abs)
    if (rec) out.push(rec)
  }
  // Newest first.
  out.sort((a, b) => b.ranAt.localeCompare(a.ranAt))
  return out
}

function isPlainRunFile(f: string): boolean {
  if (!f.endsWith('.json')) return false
  if (
    f.endsWith('.awaiting-gate.json') ||
    f.endsWith('.gate-approved.json') ||
    f.endsWith('.gate-rejected.json')
  ) {
    return false
  }
  return true
}

function readRunFile(abs: string): RunRecord | null {
  try {
    const data = JSON.parse(readFileSync(abs, 'utf-8')) as {
      title?: string
      summary?: string
      ranAt?: string
      rows?: unknown[]
      error?: { message?: string } | string | null
      meta?: { error?: string | null }
    }
    const ranAt = typeof data.ranAt === 'string' ? data.ranAt : new Date(0).toISOString()
    let error: string | null = null
    if (typeof data.error === 'string') error = data.error
    else if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') {
      error = data.error.message
    } else if (data.meta?.error) {
      error = String(data.meta.error)
    }
    return {
      ranAt,
      title: typeof data.title === 'string' && data.title.length > 0 ? data.title : '',
      summary: typeof data.summary === 'string' ? data.summary : '',
      rowCount: Array.isArray(data.rows) ? data.rows.length : 0,
      error,
      path: abs,
    }
  } catch {
    return null
  }
}

function discoverAwaitingForFramework(framework: string, now: number): AwaitingGate[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const out: AwaitingGate[] = []
  const def = findFramework(framework)
  const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)

  const pushFromFile = (abs: string) => {
    try {
      const parsed = JSON.parse(readFileSync(abs, 'utf-8')) as {
        run_id?: string
        framework?: string
        step_index?: number
        gate_id?: string
        prompt?: string
        payload?: unknown
        created_at?: string
      }
      if (!parsed || typeof parsed !== 'object') return
      const created_at = String(parsed.created_at ?? new Date().toISOString())
      if (isGateTimedOut(created_at, timeoutHours, now)) return
      out.push({
        run_id: String(parsed.run_id ?? ''),
        framework: String(parsed.framework ?? framework),
        step_index: typeof parsed.step_index === 'number' ? parsed.step_index : 0,
        gate_id: String(parsed.gate_id ?? ''),
        prompt: String(parsed.prompt ?? ''),
        payload: parsed.payload ?? null,
        created_at,
        timeout_hours: timeoutHours,
        stale: isGateStale(created_at, timeoutHours, now),
      })
    } catch {
      // Skip malformed files.
    }
  }

  // Layout 1 — `<framework>.runs/<run-id>.awaiting-gate.json`
  const runsDir = join(root, `${framework}.runs`)
  if (existsSync(runsDir) && statSync(runsDir).isDirectory()) {
    for (const f of readdirSync(runsDir)) {
      if (!f.endsWith('.awaiting-gate.json')) continue
      const runId = f.slice(0, -'.awaiting-gate.json'.length)
      if (
        existsSync(join(runsDir, `${runId}.gate-approved.json`)) ||
        existsSync(join(runsDir, `${runId}.gate-rejected.json`))
      ) {
        continue
      }
      pushFromFile(join(runsDir, f))
    }
  }
  // Layout 2 — legacy `<framework>.awaiting-gate.json`
  const legacy = join(root, `${framework}.awaiting-gate.json`)
  if (existsSync(legacy)) pushFromFile(legacy)

  // Newest first.
  out.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return out
}

dashboardRoutes.get('/list', (c) => {
  return c.json({
    archetypes: ARCHETYPES.map((a) => ({
      id: a.id,
      framework: a.framework,
      title: a.title,
      description: a.description,
    })),
  })
})

/**
 * Reports the user's pinned archetype (from `~/.gtm-os/config.yaml`).
 * The SPA reads this on /today entry to decide whether to bounce the user
 * to their archetype-specific dashboard.
 */
dashboardRoutes.get('/active', (c) => {
  const archetype = readArchetypePreference()
  return c.json({ archetype })
})

dashboardRoutes.get('/:archetype', (c) => {
  const id = c.req.param('archetype')
  const archetype = findArchetype(id)
  if (!archetype) {
    return c.json(
      {
        error: 'unknown_archetype',
        message: `Unknown archetype "${id}". Expected one of a, b, c, d.`,
      },
      404,
    )
  }

  // Auto-reject any awaiting gate that has exceeded its timeout window so
  // a stale-forever sentinel never leaks into the dashboard payload.
  try {
    enforceGateTimeouts()
  } catch {
    // Best-effort.
  }

  const installed = listInstalledFrameworks().includes(archetype.framework)
  const runs = discoverRunsForFramework(archetype.framework)
  const successful = runs.find((r) => !r.error)
  const recent = runs.slice(0, RECENT_RUNS_LIMIT)
  const awaiting = discoverAwaitingForFramework(archetype.framework, Date.now())

  // Visualizations linked to this archetype's framework. We surface the
  // framework's declared `default_visualization` plus any saved sidecar
  // metadata for it.
  const def = findFramework(archetype.framework)
  const all = listVisualizations()
  const visualizations: Array<{
    view_id: string
    intent: string
    generated: boolean
    last_generated_at: string | null
  }> = []
  if (def?.default_visualization) {
    const meta = readVisualizationMetadata(def.default_visualization.view_id)
    visualizations.push({
      view_id: def.default_visualization.view_id,
      intent: def.default_visualization.intent ?? '',
      generated: meta !== null,
      last_generated_at: meta?.last_generated_at ?? null,
    })
  }
  // Also include any saved viz that mentions the framework's default view_id
  // family — keep the surface tight; we only show defaults for now.
  // (Future: per-run visualizations could be tagged on the sidecar.)
  // Suppress unused variable lint by referencing.
  void all

  return c.json({
    archetype: {
      id: archetype.id,
      framework: archetype.framework,
      title: archetype.title,
      description: archetype.description,
    },
    installed,
    active_runs: runs.length,
    last_successful_pass: successful?.ranAt ?? null,
    awaiting_gates: awaiting,
    recent_runs: recent.map((r) => ({
      ranAt: r.ranAt,
      title: r.title || archetype.framework,
      summary: r.summary,
      rowCount: r.rowCount,
      error: r.error,
    })),
    visualizations,
  })
})
