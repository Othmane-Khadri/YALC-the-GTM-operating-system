/**
 * /api/today/* — daily feed for the SPA's /today view.
 *
 * Aggregates the latest framework runs and any pending awaiting-gate items
 * into a single chronological feed. Read-only over the disk layout the
 * dashboard adapter and (future) gate writer share:
 *
 *   ~/.gtm-os/agents/<framework>.runs/<ts>.json     (existing — dashboard adapter writes)
 *   ~/.gtm-os/agents/<framework>/runs/<ts>.json     (also accepted — newer naming)
 *   ~/.gtm-os/agents/<framework>.awaiting-gate.json (pending human-gate item, schema below)
 *
 * Awaiting-gate JSON shape (populated by 0.9.E, structurally supported here):
 *   { run_id, framework, step_index, gate_id, prompt, payload, created_at }
 *
 * Endpoints:
 *   GET  /api/today/feed              — merged + sorted feed (latest 50)
 *   POST /api/today/retry/:framework  — fire `framework:run` and return its result
 */

import { Hono } from 'hono'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const todayRoutes = new Hono()

const FEED_LIMIT = 50

// ─── Helpers ────────────────────────────────────────────────────────────────

function agentsDir(): string {
  return join(homedir(), '.gtm-os', 'agents')
}

interface DiscoveredRunFile {
  framework: string
  abs: string
}

/**
 * Walk `~/.gtm-os/agents/` and yield every run JSON file we find.
 * Accepts both the legacy `<framework>.runs/` directory and the newer
 * `<framework>/runs/` layout the spec calls out.
 */
function discoverRunFiles(): DiscoveredRunFile[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const out: DiscoveredRunFile[] = []
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (!st.isDirectory()) continue

    // Layout A — `<framework>.runs/`
    if (entry.endsWith('.runs')) {
      const framework = entry.slice(0, -'.runs'.length)
      collectJsonFiles(abs, (file) => out.push({ framework, abs: file }))
      continue
    }

    // Layout B — `<framework>/runs/`
    const runsSub = join(abs, 'runs')
    if (existsSync(runsSub) && statSync(runsSub).isDirectory()) {
      collectJsonFiles(runsSub, (file) => out.push({ framework: entry, abs: file }))
    }
  }
  return out
}

function collectJsonFiles(dir: string, push: (abs: string) => void): void {
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    push(join(dir, f))
  }
}

interface AwaitingGate {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  created_at: string
}

/**
 * Walk `~/.gtm-os/agents/<framework>.awaiting-gate.json`. The 0.9.E gate
 * writer hasn't landed yet; we structurally support the shape today so the
 * /today view "just works" once it does.
 */
function discoverAwaitingGates(): AwaitingGate[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const out: AwaitingGate[] = []
  for (const entry of readdirSync(root)) {
    if (!entry.endsWith('.awaiting-gate.json')) continue
    const abs = join(root, entry)
    try {
      const parsed = JSON.parse(readFileSync(abs, 'utf-8')) as Partial<AwaitingGate>
      if (!parsed || typeof parsed !== 'object') continue
      const framework = entry.slice(0, -'.awaiting-gate.json'.length)
      out.push({
        run_id: String(parsed.run_id ?? ''),
        framework: String(parsed.framework ?? framework),
        step_index: typeof parsed.step_index === 'number' ? parsed.step_index : 0,
        gate_id: String(parsed.gate_id ?? ''),
        prompt: String(parsed.prompt ?? ''),
        payload: parsed.payload ?? null,
        created_at: String(parsed.created_at ?? new Date().toISOString()),
      })
    } catch {
      // Best-effort — skip malformed files.
    }
  }
  return out
}

interface RunFeedItem {
  type: 'run'
  framework: string
  title: string
  summary: string
  ranAt: string
  rowCount: number
  error: string | null
  path: string
}

interface GateFeedItem {
  type: 'awaiting_gate'
  framework: string
  run_id: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  created_at: string
}

type FeedItem = RunFeedItem | GateFeedItem

function readRunFile(file: DiscoveredRunFile): RunFeedItem | null {
  try {
    const data = JSON.parse(readFileSync(file.abs, 'utf-8')) as {
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
      type: 'run',
      framework: file.framework,
      title: typeof data.title === 'string' && data.title.length > 0 ? data.title : file.framework,
      summary: typeof data.summary === 'string' ? data.summary : '',
      ranAt,
      rowCount: Array.isArray(data.rows) ? data.rows.length : 0,
      error,
      path: file.abs,
    }
  } catch {
    return null
  }
}

// ─── GET /api/today/feed ────────────────────────────────────────────────────

todayRoutes.get('/feed', (c) => {
  const runFiles = discoverRunFiles()
  const runs: RunFeedItem[] = []
  for (const f of runFiles) {
    const item = readRunFile(f)
    if (item) runs.push(item)
  }
  const gates = discoverAwaitingGates()

  const items: FeedItem[] = [
    ...runs,
    ...gates.map<GateFeedItem>((g) => ({
      type: 'awaiting_gate',
      framework: g.framework,
      run_id: g.run_id,
      step_index: g.step_index,
      gate_id: g.gate_id,
      prompt: g.prompt,
      payload: g.payload,
      created_at: g.created_at,
    })),
  ]

  // Sort newest first, mixing both item types by their primary timestamp.
  items.sort((a, b) => {
    const ta = a.type === 'run' ? a.ranAt : a.created_at
    const tb = b.type === 'run' ? b.ranAt : b.created_at
    return tb.localeCompare(ta)
  })

  const trimmed = items.slice(0, FEED_LIMIT)
  return c.json({
    items: trimmed,
    total: items.length,
    limit: FEED_LIMIT,
  })
})

// ─── POST /api/today/retry/:framework ───────────────────────────────────────

todayRoutes.post('/retry/:framework', async (c) => {
  const framework = c.req.param('framework')
  if (!framework) {
    return c.json({ error: 'bad_request', message: 'framework required' }, 400)
  }
  // Defer-load the runner so /today's read-only paths don't pay the
  // framework-registry import cost on every request.
  const { runFramework, FrameworkRunError } = await import(
    '../../frameworks/runner.js'
  )
  try {
    const { path, run } = await runFramework(framework, { seed: false })
    return c.json({ ok: true, framework, path, rowCount: run.rows.length })
  } catch (err) {
    if (err instanceof FrameworkRunError) {
      return c.json(
        {
          error: 'run_failed',
          message: err.message,
          step: err.step,
          stepSkill: err.stepSkill,
        },
        500,
      )
    }
    return c.json(
      {
        error: 'run_failed',
        message: err instanceof Error ? err.message : 'Run failed',
      },
      500,
    )
  }
})
