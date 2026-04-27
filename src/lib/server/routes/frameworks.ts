/**
 * Framework dashboard routes.
 *
 * Mounted at `/frameworks` in the campaign-dashboard server. Two endpoints:
 *
 *   GET /frameworks
 *     Index — lists every installed framework with last-run summary
 *     pulled from `~/.gtm-os/agents/<name>.runs/`.
 *
 *   GET /frameworks/:name
 *     Renders the latest run via the per-framework template (or a generic
 *     table fallback if the template is missing or no runs exist).
 *
 * The route handlers pull state from disk on every request — the
 * dashboard server is read-only over framework data; writes happen via
 * the agent runner.
 */

import { Hono } from 'hono'
import {
  listInstalledFrameworks,
  loadInstalledConfig,
  latestRun,
} from '../../frameworks/registry.js'
import { renderDashboard, escapeHtml } from '../../frameworks/output/dashboard-adapter.js'

export const frameworkRoutes = new Hono()

frameworkRoutes.get('/', (c) => {
  const installed = listInstalledFrameworks()
  if (installed.length === 0) {
    return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Frameworks</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0f0f;color:#e5e5e5;max-width:760px;margin:3rem auto;padding:0 1.5rem}
h1{margin-bottom:.5rem}p{color:#888}code{background:#1a1a1a;padding:.15rem .35rem;border-radius:4px;color:#f5c542}</style></head>
<body><h1>Frameworks</h1>
<p>No frameworks installed yet. Run <code>yalc-gtm framework:recommend</code> to see what's available for your setup.</p>
</body></html>`)
  }

  const rows = installed
    .map((name) => {
      const cfg = loadInstalledConfig(name)
      const run = latestRun(name)
      const lastRunAt = run && (run.data as { ranAt?: string }).ranAt
      const status = cfg?.disabled ? 'disabled' : 'active'
      const dest = cfg?.output.destination ?? '?'
      return `<tr>
        <td><a href="/frameworks/${escapeHtml(name)}">${escapeHtml(cfg?.display_name || name)}</a></td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(dest)}</td>
        <td>${escapeHtml(lastRunAt ?? '—')}</td>
      </tr>`
    })
    .join('')

  return c.html(`<!doctype html><html><head><meta charset="utf-8"><title>Frameworks</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0f0f0f;color:#e5e5e5;max-width:960px;margin:3rem auto;padding:0 1.5rem}
h1{margin-bottom:.25rem}.meta{color:#888;font-size:.85rem;margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:.5rem .75rem;border-bottom:1px solid #2a2a2a;font-size:.9rem}
th{background:#181818;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.05em;font-size:.7rem}
a{color:#f5c542;text-decoration:none}a:hover{text-decoration:underline}</style></head>
<body><h1>Frameworks</h1><div class="meta">${installed.length} installed</div>
<table><thead><tr><th>Framework</th><th>Status</th><th>Destination</th><th>Last run</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`)
})

frameworkRoutes.get('/:name', (c) => {
  const name = c.req.param('name')
  if (!listInstalledFrameworks().includes(name)) {
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;background:#0f0f0f;color:#e5e5e5;padding:3rem">
<h1>Framework not found</h1><p>${escapeHtml(name)} isn't installed. <a href="/frameworks" style="color:#f5c542">Back</a></p></body></html>`,
      404,
    )
  }
  return c.html(renderDashboard(name))
})
