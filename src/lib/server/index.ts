import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { bearerAuth } from 'hono/bearer-auth'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'fs'
import { join, dirname, resolve, relative } from 'path'
import { fileURLToPath } from 'url'
import { reviewRoutes } from './routes/review'
import { learningRoutes } from './routes/learning'
import { campaignRoutes } from './routes/campaigns'
import { swipeRoutes } from './routes/swipe'
import { webhookRoutes } from './routes/webhooks'
import { frameworkRoutes } from './routes/frameworks'
import { setupRoutes } from './routes/setup'
import { todayRoutes } from './routes/today'
import { brainRoutes } from './routes/brain'
import { brainSectionRoutes } from './routes/brain-section'
import { keysRoutes } from './routes/keys'
import { skillsRoutes } from './routes/skills'
import { gatesRoutes } from './routes/gates'
import { visualizeApiRoutes, visualizePageRoutes } from './routes/visualize'
import { dashboardRoutes } from './routes/dashboard'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Locate the built SPA bundle.
 *
 * The bundle is shipped via the npm tarball at `<pkg>/web/dist` and lives
 * in the same place during local development from a worktree. We prefer
 * to mount via an absolute path resolved from this module's location so
 * the server is robust against `process.cwd()` drift (CLI, tests, daemon).
 */
function resolveWebDist(): string | null {
  const candidates = [
    resolve(__dirname, '..', '..', '..', 'web', 'dist'),
    resolve(process.cwd(), 'web', 'dist'),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) return c
  }
  return null
}

/**
 * Hono's serveStatic resolves `root` against CWD, not absolute paths. Convert
 * an absolute dist directory into a CWD-relative root the helper can consume.
 */
function asServeStaticRoot(absDir: string): string {
  const rel = relative(process.cwd(), absDir)
  // Always normalise to forward slashes; serveStatic concatenates with the
  // request path which uses /.
  return rel.split(/[\\/]+/).join('/') || '.'
}

export function createApp() {
  const app = new Hono()

  // CORS — include the Vite dev server so engineers can run the SPA from
  // :5173 against the Hono API on :3847.
  const corsOrigins = [
    'http://localhost:3847',
    'http://127.0.0.1:3847',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ]
  app.use('*', cors({ origin: corsOrigins }))

  // Protect API routes with bearer token (GTM_OS_API_TOKEN)
  const apiToken = process.env.GTM_OS_API_TOKEN
  if (apiToken) {
    app.use('/api/*', bearerAuth({ token: apiToken }))
  }

  // API routes
  app.route('/api/review', reviewRoutes)
  app.route('/api/learning', learningRoutes)
  app.route('/api/campaigns', campaignRoutes)
  app.route('/api/swipe', swipeRoutes)
  app.route('/api/webhooks', webhookRoutes)
  app.route('/api/setup', setupRoutes)
  app.route('/api/today', todayRoutes)
  app.route('/api/brain', brainRoutes)
  app.route('/api/brain', brainSectionRoutes)
  app.route('/api/keys', keysRoutes)
  app.route('/api/skills', skillsRoutes)
  app.route('/api/gates', gatesRoutes)
  app.route('/api/visualize', visualizeApiRoutes)
  app.route('/api/dashboard', dashboardRoutes)

  // Generated visualization page — serves saved HTML from
  // `~/.gtm-os/visualizations/<view_id>.html` with the right Content-Type.
  // Mounted BEFORE the SPA fallback so the page route wins.
  app.route('/visualize', visualizePageRoutes)

  // Framework dashboard routes.
  // DEPRECATED in 1.0.0 — installed framework runs surface in /today and
  // per-framework detail moves into the SPA. Kept for 0.9.x scripts that
  // open `/frameworks/<name>` directly (e.g. `framework:install --open`).
  app.route('/frameworks', frameworkRoutes)

  // Legacy static HTML pages — served BEFORE the SPA fallback so they win.
  // DEPRECATION: these dashboards retire in 1.0.0 once the SPA equivalents
  // (/today, /brain, /keys, /skills) cover their feature surface. They're
  // kept reachable through 0.9.x so existing scripts and bookmarks survive
  // the cut-over window.

  // DEPRECATED in 1.0.0 — replaced by /review functionality folded into
  // /today + the Approve gate flow. SPA migration tracked separately.
  app.get('/review', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'review.html'), 'utf-8')
    return c.html(html)
  })

  // DEPRECATED in 1.0.0 — RL skill optimisation moves into /skills detail.
  app.get('/swipe/:sessionId', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'swipe.html'), 'utf-8')
    return c.html(html)
  })

  // DEPRECATED in 1.0.0 — campaign overview folds into /today; per-campaign
  // detail will live under /campaigns/:id in the SPA.
  app.get('/campaigns', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'campaigns.html'), 'utf-8')
    return c.html(html)
  })

  // DEPRECATED in 1.0.0 — see /campaigns above.
  app.get('/campaigns/:id', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'campaign-detail.html'), 'utf-8')
    return c.html(html)
  })

  // DEPRECATED in 1.0.0 — monthly report becomes a /today filter once the
  // run timeline gains date pinning.
  app.get('/monthly-report', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'monthly-report.html'), 'utf-8')
    return c.html(html)
  })

  // SPA mount — built bundle from web/dist. If the bundle isn't built we
  // fall through to the legacy inline landing page so dev-without-build
  // still has something to look at.
  const webDist = resolveWebDist()
  if (webDist) {
    const root = asServeStaticRoot(webDist)
    // Static assets (JS/CSS/images/fonts under dist/assets/...).
    app.use('/assets/*', serveStatic({ root }))
    // Other top-level files Vite emits (favicons, robots.txt, etc.).
    app.use(
      '/*',
      serveStatic({
        root,
        rewriteRequestPath: (p: string) => {
          // Skip API + framework + legacy routes — they're already handled.
          if (
            p.startsWith('/api') ||
            p.startsWith('/frameworks') ||
            p.startsWith('/visualize/') ||
            p === '/review' ||
            p === '/campaigns' ||
            p.startsWith('/campaigns/') ||
            p === '/monthly-report' ||
            p.startsWith('/swipe/')
          ) {
            return '/__skip__'
          }
          return p
        },
      }),
    )

    // SPA fallback — any GET that didn't match a static file or earlier
    // route serves index.html so client-side routing can take over.
    app.get('*', (c) => {
      const path = c.req.path
      if (
        path.startsWith('/api') ||
        path.startsWith('/frameworks') ||
        path.startsWith('/visualize/') ||
        path === '/review' ||
        path === '/campaigns' ||
        path.startsWith('/campaigns/') ||
        path === '/monthly-report' ||
        path.startsWith('/swipe/')
      ) {
        return c.notFound()
      }
      const html = readFileSync(join(webDist, 'index.html'), 'utf-8')
      return c.html(html)
    })
  } else {
    // Bundle not present — keep the original inline landing as a fallback
    // so a fresh checkout without `pnpm build:web` is still navigable.
    app.get('/', (c) => {
      return c.html(`<!DOCTYPE html>
<html><head><title>GTM-OS</title>
<style>body{font-family:system-ui;background:#F8EDE8;color:#1a1a1a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.container{text-align:center;max-width:420px}h1{font-size:2.4rem;margin-bottom:.5rem;font-weight:700}
p{color:rgba(26,26,26,0.65);margin-bottom:2rem}a{display:block;padding:1rem;margin:.5rem 0;background:#fff;border:1px solid rgba(26,26,26,0.12);border-radius:14px;color:#C9506E;text-decoration:none;font-weight:600}
a:hover{box-shadow:0 8px 24px rgba(201,80,110,0.08)}</style></head>
<body><div class="container"><h1>YALC</h1><p>Run <code>pnpm build:web</code> to load the full SPA.</p>
<a href="/campaigns">Campaign Dashboard</a>
<a href="/review">Lead Review Dashboard</a>
<a href="/frameworks">Frameworks</a>
<a href="/swipe/demo">Skill Optimization (RL)</a>
</div></body></html>`)
    })
  }

  return app
}

export function startServer(port = 3847) {
  const app = createApp()
  console.log(`\nGTM-OS Server: http://localhost:${port}`)
  console.log('  /campaigns — Campaign dashboard')
  console.log('  /review    — Lead review dashboard')
  console.log('  /frameworks — Installed framework dashboards')
  console.log('  /swipe     — Skill optimization\n')
  const server = serve({ fetch: app.fetch, port })
  // Surface EADDRINUSE (and other listen errors) instead of letting Node
  // crash with an uncaught exception. Callers that care can attach their
  // own listener; otherwise we re-emit a clear message and exit non-zero.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} is already in use.`)
      console.error(`Either stop the existing process (lsof -i :${port}) or run with a different port:`)
      console.error(`  yalc-gtm start --port ${port + 1}`)
      process.exit(1)
    }
    console.error(`Server error: ${err.message}`)
    process.exit(1)
  })
  return server
}
