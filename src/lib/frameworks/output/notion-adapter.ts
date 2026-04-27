/**
 * Notion output adapter.
 *
 * 0.7.0 ships a deliberately narrow Notion path:
 *
 *   - On install, we DO NOT auto-create a database — we only validate that
 *     the user has both `NOTION_API_KEY` set and a `notion_parent_page` ID
 *     supplied at install time.
 *
 *   - Per-run output is appended as a child page under the parent page,
 *     with a markdown body summarizing the run + a small table.
 *
 *   - Idempotency keys are not yet supported (we trade row-level upserts
 *     for the simpler "one child page per run" shape). Frameworks that
 *     truly need upsert semantics should pick the dashboard destination
 *     for now.
 *
 * If the user ships up an integration that complicates the page schema,
 * the wizard logs the failure and falls back to the dashboard route — the
 * framework still runs, output is still readable, the user is unblocked.
 */

import { NotionService } from '../../services/notion.js'

export interface NotionRunPayload {
  /** Friendly title for the new child page. */
  title: string
  /** Optional one-paragraph summary written above the table. */
  summary?: string
  /** Tabular rows. Keys become column headers in the rendered markdown. */
  rows: Array<Record<string, unknown>>
  /** ISO timestamp the run completed. */
  ranAt: string
}

export interface NotionAdapterOptions {
  /** Parent page (NOT database) ID under which child pages are created. */
  parentPageId: string
}

/** Stable identifier we'll use later for upsert support. */
export interface InstalledNotionTarget {
  parentPageId: string
}

/** Sentinel error so the wizard / runner can detect "Notion not set up". */
export class NotionAdapterUnavailableError extends Error {
  constructor(detail: string) {
    super(`Notion adapter unavailable: ${detail}`)
    this.name = 'NotionAdapterUnavailableError'
  }
}

function ensureAvailable(): NotionService {
  const svc = new NotionService()
  if (!svc.isAvailable()) {
    throw new NotionAdapterUnavailableError(
      'NOTION_API_KEY missing — set it in ~/.gtm-os/.env then re-run',
    )
  }
  return svc
}

/**
 * Validate the install can target the chosen parent. Throws on missing
 * key. Does NOT verify the parent page exists — Notion's permission model
 * makes a deep validate slow, and the first run will surface any error.
 */
export function validateNotionTarget(opts: NotionAdapterOptions): InstalledNotionTarget {
  ensureAvailable()
  if (!opts.parentPageId || opts.parentPageId.length < 8) {
    throw new NotionAdapterUnavailableError('parentPageId required')
  }
  return { parentPageId: opts.parentPageId }
}

/**
 * Append a run as a new child page. **NOT YET IMPLEMENTED in 0.7.0.**
 *
 * The runtime path uses the dashboard destination today. We still ship
 * the validation entry point so install-time choice + UI flow can be
 * wired end-to-end. Calling `appendRun()` throws so we fail loudly
 * rather than silently dropping output.
 */
export async function appendRun(
  _target: InstalledNotionTarget,
  _payload: NotionRunPayload,
): Promise<{ pageId: string }> {
  ensureAvailable()
  throw new NotionAdapterUnavailableError(
    'Notion output not yet implemented in 0.7.0 — pick the dashboard destination at install time',
  )
}

/** Quick check used by the wizard to decide whether the option is offered. */
export function notionDestinationAvailable(): boolean {
  return !!process.env.NOTION_API_KEY
}
