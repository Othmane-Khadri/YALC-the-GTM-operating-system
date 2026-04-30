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
import {
  listVisualizations,
  readVisualizationMetadata,
  readVisualizationPage,
} from '../../visualize/storage.js'
import { loadAllFrameworks } from '../../frameworks/loader.js'
import { listInstalledFrameworks } from '../../frameworks/registry.js'

export const visualizeApiRoutes = new Hono()

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
