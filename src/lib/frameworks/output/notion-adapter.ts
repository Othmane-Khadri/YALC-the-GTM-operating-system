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
 * Append a run as a new child page under the configured parent.
 *
 * The page title appends the run's `ranAt` ISO timestamp so re-runs
 * never collide on Notion's title-based natural-key matching. The
 * body contains a markdown rendering of `payload.summary` followed by
 * a markdown table built from `payload.rows`.
 */
export async function appendRun(
  target: InstalledNotionTarget,
  payload: NotionRunPayload,
): Promise<{ pageId: string }> {
  const svc = ensureAvailable()
  const titleWithStamp = `${payload.title} — ${payload.ranAt}`
  const blocks = renderRunBlocks(payload)
  const res = await svc.createChildPage(target.parentPageId, titleWithStamp, blocks)
  return { pageId: res.id }
}

/** Build the Notion block children that render summary + rows. */
function renderRunBlocks(payload: NotionRunPayload): unknown[] {
  const blocks: unknown[] = []
  if (payload.summary && payload.summary.trim().length > 0) {
    blocks.push(paragraphBlock(payload.summary))
  }
  if (payload.rows.length === 0) {
    blocks.push(paragraphBlock('(no rows in this run)'))
    return blocks
  }
  // Render as a markdown-style code block — Notion native tables require a
  // heavier API surface (table block + table_row child blocks per row) and
  // for the framework runner's "log this run" use case the markdown shape
  // is plenty + readable in mobile + fallback clients.
  const md = renderMarkdownTable(payload.rows)
  blocks.push(codeBlock(md))
  return blocks
}

function paragraphBlock(text: string): unknown {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
    },
  }
}

function codeBlock(text: string): unknown {
  return {
    object: 'block',
    type: 'code',
    code: {
      language: 'markdown',
      // Notion caps a block's text at 2000 chars; clip to be safe.
      rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
    },
  }
}

/** Plain markdown-table renderer that preserves the row order from input. */
export function renderMarkdownTable(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return '(no rows)'
  // Column order: stable + matches the first row's key order.
  const cols = Array.from(
    rows.reduce<Set<string>>((acc, r) => {
      for (const k of Object.keys(r)) acc.add(k)
      return acc
    }, new Set()),
  )
  const header = `| ${cols.join(' | ')} |`
  const sep = `| ${cols.map(() => '---').join(' | ')} |`
  const body = rows
    .map((row) => `| ${cols.map((c) => fmtCell(row[c])).join(' | ')} |`)
    .join('\n')
  return [header, sep, body].join('\n')
}

function fmtCell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.replace(/\|/g, '\\|').replace(/\n/g, ' ')
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v).replace(/\|/g, '\\|')
  } catch {
    return String(v)
  }
}

/** Quick check used by the wizard to decide whether the option is offered. */
export function notionDestinationAvailable(): boolean {
  return !!process.env.NOTION_API_KEY
}
