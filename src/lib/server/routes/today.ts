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
import { streamSSE } from 'hono/streaming'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  enforceGateTimeouts,
  isGateStale,
  isGateTimedOut,
  resolveGateTimeoutHours,
} from '../../frameworks/gate-timeouts.js'
import { findFramework } from '../../frameworks/loader.js'
import { subscribeTodayEvents, type TodayEvent } from '../event-bus.js'

/** Heartbeat cadence — proxies typically idle-out at ~30s, so beat at 25s. */
const SSE_HEARTBEAT_MS = 25_000

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
    // Skip gate sentinels — those are surfaced through discoverAwaitingGates,
    // not as completed-run feed cards. Also skip approved/rejected sentinels.
    if (
      f.endsWith('.awaiting-gate.json') ||
      f.endsWith('.gate-approved.json') ||
      f.endsWith('.gate-rejected.json')
    ) {
      continue
    }
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
 * Walk for awaiting-gate sentinels. Two layouts are supported:
 *
 *   1. `~/.gtm-os/agents/<framework>.runs/<run-id>.awaiting-gate.json`
 *      (canonical 0.9.E runner output — one per paused run).
 *   2. `~/.gtm-os/agents/<framework>.awaiting-gate.json` (legacy
 *      single-per-framework shape; kept so 0.9.C-era seed harnesses
 *      and any pre-runner scripts that wrote the sentinel keep working).
 */
function discoverAwaitingGates(): AwaitingGate[] {
  const root = agentsDir()
  if (!existsSync(root)) return []
  const out: AwaitingGate[] = []
  const pushFromFile = (abs: string, fallbackFramework: string) => {
    try {
      const parsed = JSON.parse(readFileSync(abs, 'utf-8')) as Partial<AwaitingGate>
      if (!parsed || typeof parsed !== 'object') return
      out.push({
        run_id: String(parsed.run_id ?? ''),
        framework: String(parsed.framework ?? fallbackFramework),
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
  for (const entry of readdirSync(root)) {
    const abs = join(root, entry)
    let st
    try {
      st = statSync(abs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      // Layout 1 — `<framework>.runs/<run-id>.awaiting-gate.json`.
      if (!entry.endsWith('.runs')) continue
      const framework = entry.slice(0, -'.runs'.length)
      for (const f of readdirSync(abs)) {
        if (!f.endsWith('.awaiting-gate.json')) continue
        // Suppress sentinels that have already been processed (an
        // approved or rejected sibling exists for the same run-id).
        const runId = f.slice(0, -'.awaiting-gate.json'.length)
        if (
          existsSync(join(abs, `${runId}.gate-approved.json`)) ||
          existsSync(join(abs, `${runId}.gate-rejected.json`))
        ) {
          continue
        }
        pushFromFile(join(abs, f), framework)
      }
      continue
    }
    // Layout 2 — legacy single-per-framework file.
    if (entry.endsWith('.awaiting-gate.json')) {
      const framework = entry.slice(0, -'.awaiting-gate.json'.length)
      pushFromFile(abs, framework)
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
  /** 'on-demand' or 'scheduled' — surfaced so the SPA can show Trigger now (D4). */
  mode: 'on-demand' | 'scheduled'
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
  /** Resolved timeout (hours) for this gate's framework. */
  timeout_hours: number
  /** True when within the last 20% of the timeout window. */
  stale: boolean
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
    const def = findFramework(file.framework)
    const mode: 'on-demand' | 'scheduled' = def?.mode === 'on-demand' ? 'on-demand' : 'scheduled'
    return {
      type: 'run',
      framework: file.framework,
      title: typeof data.title === 'string' && data.title.length > 0 ? data.title : file.framework,
      summary: typeof data.summary === 'string' ? data.summary : '',
      ranAt,
      rowCount: Array.isArray(data.rows) ? data.rows.length : 0,
      error,
      path: file.abs,
      mode,
    }
  } catch {
    return null
  }
}

// ─── GET /api/today/feed ────────────────────────────────────────────────────

todayRoutes.get('/feed', (c) => {
  // Auto-reject any awaiting gate that has exceeded its timeout window so
  // the feed never surfaces stale-forever items.
  try {
    enforceGateTimeouts()
  } catch {
    // Best-effort — feed should still render even if the timeout pass fails.
  }
  const runFiles = discoverRunFiles()
  const runs: RunFeedItem[] = []
  for (const f of runFiles) {
    const item = readRunFile(f)
    if (item) runs.push(item)
  }
  const gates = discoverAwaitingGates()
  const now = Date.now()

  const items: FeedItem[] = [
    ...runs,
    ...gates
      .filter((g) => {
        // Defensive: a gate that enforceGateTimeouts didn't catch (e.g.
        // bundled framework not on disk during a test) shouldn't surface
        // as awaiting if it's already past the window.
        const def = findFramework(g.framework)
        const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)
        return !isGateTimedOut(g.created_at, timeoutHours, now)
      })
      .map<GateFeedItem>((g) => {
        const def = findFramework(g.framework)
        const timeoutHours = resolveGateTimeoutHours(def?.gate_timeout_hours)
        return {
          type: 'awaiting_gate',
          framework: g.framework,
          run_id: g.run_id,
          step_index: g.step_index,
          gate_id: g.gate_id,
          prompt: g.prompt,
          payload: g.payload,
          created_at: g.created_at,
          timeout_hours: timeoutHours,
          stale: isGateStale(g.created_at, timeoutHours, now),
        }
      }),
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

// ─── POST /api/today/trigger/:framework ─────────────────────────────────────

todayRoutes.post('/trigger/:framework', async (c) => {
  const framework = c.req.param('framework')
  if (!framework) {
    return c.json({ error: 'bad_request', message: 'framework required' }, 400)
  }
  const { triggerOnDemandFramework } = await import('../../frameworks/trigger.js')
  const result = await triggerOnDemandFramework({ framework, source: 'spa' })
  if (result.ok) {
    return c.json({ ok: true, framework: result.framework, run_id: result.runId })
  }
  if (result.rejection.kind === 'unknown') {
    return c.json({ error: 'unknown_framework', framework }, 404)
  }
  return c.json({ error: 'not_on_demand', framework, mode: result.rejection.mode }, 400)
})

// ─── GET /api/today/stream ──────────────────────────────────────────────────
//
// Server-Sent Events feed of /today state transitions. Subscribed by the SPA's
// /today page so gate transitions and run completions splice in without a
// full reload. Heartbeat comment every SSE_HEARTBEAT_MS ms so HTTP/1.1 proxies
// don't close the idle connection.

todayRoutes.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const queue: TodayEvent[] = []
    let resolveWaiter: (() => void) | null = null
    const wakeup = () => {
      if (resolveWaiter) {
        const r = resolveWaiter
        resolveWaiter = null
        r()
      }
    }
    const unsubscribe = subscribeTodayEvents((event) => {
      queue.push(event)
      wakeup()
    })
    // Cleanly tear down the listener when the client disconnects.
    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribe()
      wakeup()
    })

    let lastBeatAt = Date.now()
    while (!c.req.raw.signal.aborted) {
      // Drain the queue first.
      while (queue.length > 0) {
        const next = queue.shift() as TodayEvent
        await stream.writeSSE({
          event: next.type,
          data: JSON.stringify(next.item),
        })
      }
      // Fire heartbeat if the cadence elapsed.
      const now = Date.now()
      const sinceBeat = now - lastBeatAt
      if (sinceBeat >= SSE_HEARTBEAT_MS) {
        await stream.write(`:heartbeat\n\n`)
        lastBeatAt = now
      }
      const sleepFor = Math.max(50, SSE_HEARTBEAT_MS - sinceBeat)
      await new Promise<void>((resolve) => {
        resolveWaiter = resolve
        setTimeout(resolve, sleepFor)
      })
    }
    unsubscribe()
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
