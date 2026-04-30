/**
 * `yalc-gtm visualize <view_id>` — generate a tailored interactive page
 * from local JSON data and an intent string.
 *
 * Re-running with the same `view_id` overwrites the saved HTML + sidecar.
 * The `--open` flag launches the user's default browser to
 * `http://localhost:<port>/visualize/<view_id>`.
 */

import { runVisualize } from '../../lib/visualize/runner.js'

export interface VisualizeCliOpts {
  data: string[]
  intent: string
  open?: boolean
  port?: number
  /** Test override for the browser-open helper. */
  openBrowser?: (url: string) => unknown
}

export interface VisualizeCliResult {
  view_id: string
  page_path: string
  url: string
  idiom: string
  summary?: string
  exitCode: number
}

export async function runVisualizeCli(
  viewId: string,
  opts: VisualizeCliOpts,
): Promise<VisualizeCliResult> {
  if (!viewId) {
    console.error('view_id is required.')
    return { view_id: '', page_path: '', url: '', idiom: '', exitCode: 1 }
  }
  if (!opts.intent || opts.intent.trim().length === 0) {
    console.error('--intent is required (one-line description of the page).')
    return { view_id: viewId, page_path: '', url: '', idiom: '', exitCode: 1 }
  }
  if (!opts.data || opts.data.length === 0) {
    console.error('--data is required (one or more JSON file paths or globs).')
    return { view_id: viewId, page_path: '', url: '', idiom: '', exitCode: 1 }
  }

  const port = opts.port ?? 3847
  const url = `http://localhost:${port}/visualize/${encodeURIComponent(viewId)}`

  let result
  try {
    result = await runVisualize({
      view_id: viewId,
      data_paths: opts.data,
      intent: opts.intent,
    })
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return { view_id: viewId, page_path: '', url, idiom: '', exitCode: 1 }
  }

  console.log(`Wrote ${result.page_path}`)
  console.log(`Sidecar ${result.metadata_path}`)
  console.log(`Idiom: ${result.idiom}`)
  if (result.summary) console.log(`Summary: ${result.summary}`)
  console.log(`URL: ${url}`)

  if (opts.open) {
    const opener = opts.openBrowser ?? (await import('../../lib/cli/open-browser.js')).openBrowser
    try {
      opener(url)
    } catch {
      // Best-effort — user can still navigate manually.
    }
  }

  return {
    view_id: viewId,
    page_path: result.page_path,
    url,
    idiom: result.idiom,
    summary: result.summary,
    exitCode: 0,
  }
}
