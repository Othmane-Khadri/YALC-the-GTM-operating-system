/**
 * Dashboard output adapter.
 *
 * Each installed framework has a runs directory at
 * `~/.gtm-os/agents/<name>.runs/`. Run JSON files there look like:
 *
 *   { "title": "...", "summary": "...", "rows": [{...}, ...], "ranAt": "..." }
 *
 * The dashboard adapter is responsible for two things:
 *
 *   1. Persisting a run via `writeRun()` (called by the framework runner).
 *   2. Reading the latest run for a given framework so the route handler
 *      can render it (`readLatestRun()`).
 *
 * Templates are loaded from `configs/frameworks/templates/html/<name>.hbs`.
 * If the template file is missing we fall back to a generic table renderer
 * so the route still returns 200 with sensible HTML.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PKG_ROOT } from '../../paths.js'
import { latestRun, runsDir } from '../registry.js'

/** Shape of a single dashboard run output. */
export interface DashboardRun {
  title: string
  summary?: string
  rows: Array<Record<string, unknown>>
  ranAt: string
  meta?: Record<string, unknown>
}

/** Persist a run JSON to `~/.gtm-os/agents/<name>.runs/<ts>.json`. */
export function writeRun(framework: string, run: DashboardRun): string {
  const dir = runsDir(framework)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const stamp = run.ranAt.replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}.json`)
  writeFileSync(file, JSON.stringify(run, null, 2) + '\n', 'utf-8')
  return file
}

/** Read the most recent run for a framework. Null = no runs. */
export function readLatestRun(framework: string): DashboardRun | null {
  const r = latestRun(framework)
  if (!r) return null
  return r.data as DashboardRun
}

/** Resolve template path. Returns null when no per-framework template exists. */
export function resolveTemplatePath(framework: string): string | null {
  const p = join(PKG_ROOT, 'configs', 'frameworks', 'templates', 'html', `${framework}.hbs`)
  return existsSync(p) ? p : null
}

/** HTML-escape a string for safe interpolation into the body of a template. */
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Tiny Handlebars-subset renderer.
 *
 * Supports:
 *   {{var}}                   → escaped value
 *   {{{var}}}                 → raw value (use sparingly)
 *   {{#each rows}}…{{/each}}  → iterate over an array, inner refs to . / .name
 *
 * Unknown / missing variables render as empty string.
 *
 * We deliberately don't pull in the full handlebars npm dep for one
 * adapter — the template surface is small and fixed, and rolling our own
 * keeps the published tarball lean.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  // Process {{#each list}} ... {{/each}} blocks.
  let out = template.replace(
    /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, listKey: string, inner: string) => {
      const arr = resolvePath(data, listKey)
      if (!Array.isArray(arr)) return ''
      return arr
        .map((item) => {
          const scope =
            typeof item === 'object' && item !== null
              ? { ...(data as Record<string, unknown>), ...(item as Record<string, unknown>), '.': item }
              : { ...(data as Record<string, unknown>), '.': item }
          return renderSimple(inner, scope as Record<string, unknown>)
        })
        .join('')
    },
  )
  out = renderSimple(out, data)
  return out
}

function renderSimple(template: string, data: Record<string, unknown>): string {
  let out = template.replace(/\{\{\{([\w.]+)\}\}\}/g, (_m, key: string) => {
    const v = resolvePath(data, key)
    return v == null ? '' : String(v)
  })
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_m, key: string) => {
    const v = resolvePath(data, key)
    return escapeHtml(v)
  })
  return out
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  if (path === '.') return data['.']
  const segments = path.split('.')
  let cur: unknown = data
  for (const s of segments) {
    if (cur == null) return undefined
    if (typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[s]
  }
  return cur
}

/** Default fallback HTML when no per-framework template is on disk. */
export function defaultDashboardHtml(framework: string, run: DashboardRun | null): string {
  const head = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(framework)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0f0f;color:#e5e5e5;max-width:960px;margin:2rem auto;padding:0 1rem}
h1{margin-bottom:.25rem}.meta{color:#888;font-size:.85rem;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;margin-top:1rem}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #2a2a2a;font-size:.9rem}
th{background:#181818;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:.7rem}
.empty{color:#888;font-style:italic}</style></head><body>`
  if (!run) {
    return `${head}<h1>${escapeHtml(framework)}</h1><p class="empty">No runs yet. Trigger one with: <code>yalc-gtm framework:run ${escapeHtml(framework)}</code></p></body></html>`
  }
  const cols = run.rows.length > 0 ? Object.keys(run.rows[0]) : []
  const head2 = cols.length > 0
    ? `<thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>`
    : ''
  const body = cols.length > 0
    ? run.rows
        .map(
          (row) =>
            `<tr>${cols.map((c) => `<td>${escapeHtml((row as Record<string, unknown>)[c])}</td>`).join('')}</tr>`,
        )
        .join('')
    : '<tr><td class="empty">No rows in latest run.</td></tr>'
  const summary = run.summary ? `<p>${escapeHtml(run.summary)}</p>` : ''
  return `${head}<h1>${escapeHtml(run.title || framework)}</h1>
<div class="meta">Last run: ${escapeHtml(run.ranAt)}</div>${summary}
<table>${head2}<tbody>${body}</tbody></table></body></html>`
}

/** Render a framework's latest run, applying its template if present. */
export function renderDashboard(framework: string): string {
  const run = readLatestRun(framework)
  const tpl = resolveTemplatePath(framework)
  if (!tpl || !run) {
    return defaultDashboardHtml(framework, run)
  }
  try {
    const raw = readFileSync(tpl, 'utf-8')
    return renderTemplate(raw, { framework, ...(run as unknown as Record<string, unknown>) })
  } catch {
    return defaultDashboardHtml(framework, run)
  }
}
