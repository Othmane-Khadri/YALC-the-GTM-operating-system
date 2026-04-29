/**
 * Visualization storage — read/write generated HTML pages and sidecar metadata.
 *
 * Layout (per view_id):
 *   ~/.gtm-os/visualizations/<view_id>.html   — generated page
 *   ~/.gtm-os/visualizations/<view_id>.json   — sidecar metadata
 *
 * Sidecar shape:
 *   {
 *     view_id: string,
 *     intent: string,
 *     idiom: string,
 *     data_paths: string[],
 *     last_generated_at: string (ISO),
 *     summary?: string
 *   }
 *
 * Idempotency: writeVisualization() unconditionally overwrites both the
 * HTML and the sidecar so re-running the visualize skill with the same
 * view_id refreshes the saved page and bumps `last_generated_at`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface VisualizationMetadata {
  view_id: string
  intent: string
  idiom: string
  data_paths: string[]
  last_generated_at: string
  summary?: string
}

/** Resolved at call time so HOME pivots in tests are honoured. */
export function visualizationsDir(): string {
  return join(homedir(), '.gtm-os', 'visualizations')
}

function ensureDir(): string {
  const dir = visualizationsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/** Validate that a view_id is safe to use as a filename. */
function assertViewId(viewId: string): void {
  if (typeof viewId !== 'string' || viewId.length === 0) {
    throw new Error('view_id is required')
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(viewId)) {
    throw new Error(
      `view_id "${viewId}" must be alphanumeric + hyphens (1-64 chars)`,
    )
  }
}

export interface WriteVisualizationInput {
  view_id: string
  intent: string
  idiom: string
  html: string
  data_paths: string[]
  summary?: string
}

export interface WriteVisualizationResult {
  page_path: string
  metadata_path: string
  metadata: VisualizationMetadata
}

export function writeVisualization(input: WriteVisualizationInput): WriteVisualizationResult {
  assertViewId(input.view_id)
  const dir = ensureDir()
  const pagePath = join(dir, `${input.view_id}.html`)
  const metaPath = join(dir, `${input.view_id}.json`)
  const metadata: VisualizationMetadata = {
    view_id: input.view_id,
    intent: input.intent,
    idiom: input.idiom,
    data_paths: input.data_paths,
    last_generated_at: new Date().toISOString(),
    summary: input.summary,
  }
  writeFileSync(pagePath, input.html, 'utf-8')
  writeFileSync(metaPath, JSON.stringify(metadata, null, 2) + '\n', 'utf-8')
  return { page_path: pagePath, metadata_path: metaPath, metadata }
}

export function readVisualizationPage(viewId: string): string | null {
  assertViewId(viewId)
  const path = join(visualizationsDir(), `${viewId}.html`)
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8')
}

export function readVisualizationMetadata(viewId: string): VisualizationMetadata | null {
  assertViewId(viewId)
  const path = join(visualizationsDir(), `${viewId}.json`)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as VisualizationMetadata
  } catch {
    return null
  }
}

export function listVisualizations(): VisualizationMetadata[] {
  const dir = visualizationsDir()
  if (!existsSync(dir)) return []
  const out: VisualizationMetadata[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const meta = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as VisualizationMetadata
      if (meta && typeof meta.view_id === 'string') out.push(meta)
    } catch {
      // Best-effort — skip unreadable sidecars.
    }
  }
  // Newest first.
  out.sort((a, b) =>
    String(b.last_generated_at).localeCompare(String(a.last_generated_at)),
  )
  return out
}
