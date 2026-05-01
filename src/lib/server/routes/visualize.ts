/**
 * /api/visualize/* + /visualize/<view_id> routes.
 *
 * Endpoints:
 *   GET /api/visualize/list      — all saved visualizations + sidecar metadata
 *   GET /api/visualize/:viewId   — single saved visualization sidecar JSON
 *   GET /visualize/:viewId       — serves the saved HTML file (text/html)
 *
 * The runner writes both files via `lib/visualize/storage.ts`. This route
 * is read-only — re-generation goes through the CLI / framework install
 * hook so the work appears in the user's terminal session.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import {
  listVisualizations,
  readVisualizationMetadata,
  readVisualizationPage,
} from '../../visualize/storage.js'
import { loadAllFrameworks } from '../../frameworks/loader.js'
import { listInstalledFrameworks } from '../../frameworks/registry.js'
import { subscribeVisualizeEvents, type VisualizeEvent } from '../event-bus.js'

const SSE_HEARTBEAT_MS = 25_000

export const visualizeApiRoutes = new Hono()

// ─── GET /api/visualize/stream ──────────────────────────────────────────────

visualizeApiRoutes.get('/stream', (c) => {
  return streamSSE(c, async (stream) => {
    const queue: VisualizeEvent[] = []
    let resolveWaiter: (() => void) | null = null
    const wakeup = () => {
      if (resolveWaiter) {
        const r = resolveWaiter
        resolveWaiter = null
        r()
      }
    }
    const unsubscribe = subscribeVisualizeEvents((event) => {
      queue.push(event)
      wakeup()
    })
    c.req.raw.signal.addEventListener('abort', () => {
      unsubscribe()
      wakeup()
    })

    let lastBeatAt = Date.now()
    while (!c.req.raw.signal.aborted) {
      while (queue.length > 0) {
        const next = queue.shift() as VisualizeEvent
        await stream.writeSSE({
          event: next.type,
          data: JSON.stringify(next.item),
        })
      }
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

visualizeApiRoutes.get('/list', (c) => {
  const items = listVisualizations()
  // Per-framework default visualizations — surfaces both the saved view
  // metadata (when generated) and the framework's declared default so the
  // SPA can render a "Visualize" link per installed framework even before
  // the seed-time generation has run.
  const installed = new Set(listInstalledFrameworks())
  const frameworks: Array<{
    framework: string
    view_id: string
    intent: string
    generated: boolean
  }> = []
  for (const f of loadAllFrameworks()) {
    if (!f.default_visualization) continue
    if (!installed.has(f.name)) continue
    const generated = !!readVisualizationMetadata(f.default_visualization.view_id)
    frameworks.push({
      framework: f.name,
      view_id: f.default_visualization.view_id,
      intent: f.default_visualization.intent,
      generated,
    })
  }
  return c.json({ items, total: items.length, frameworks })
})

visualizeApiRoutes.get('/:viewId', (c) => {
  const viewId = c.req.param('viewId')
  if (!viewId) {
    return c.json({ error: 'bad_request', message: 'viewId required' }, 400)
  }
  let meta
  try {
    meta = readVisualizationMetadata(viewId)
  } catch (err) {
    return c.json(
      {
        error: 'bad_request',
        message: err instanceof Error ? err.message : String(err),
      },
      400,
    )
  }
  if (!meta) {
    return c.json(
      { error: 'not_found', message: `No visualization for ${viewId}` },
      404,
    )
  }
  return c.json(meta)
})

/**
 * Top-level page route — registered against the main app at `/visualize/:viewId`.
 * Returns the saved HTML with `Content-Type: text/html; charset=utf-8`. Any
 * unsafe view_id surfaces a 400, missing pages surface a 404.
 */
export const visualizePageRoutes = new Hono()

visualizePageRoutes.get('/:viewId', (c) => {
  const viewId = c.req.param('viewId')
  if (!viewId) {
    return c.text('viewId required', 400)
  }
  let html
  try {
    html = readVisualizationPage(viewId)
  } catch (err) {
    return c.text(err instanceof Error ? err.message : String(err), 400)
  }
  if (html == null) {
    return c.text(`No visualization for ${viewId}`, 404)
  }
  c.header('Content-Type', 'text/html; charset=utf-8')
  return c.body(html)
})
