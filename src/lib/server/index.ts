import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { reviewRoutes } from './routes/review'
import { learningRoutes } from './routes/learning'
import { campaignRoutes } from './routes/campaigns'
import { swipeRoutes } from './routes/swipe'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = new Hono()

  app.use('*', cors())

  // API routes
  app.route('/api/review', reviewRoutes)
  app.route('/api/learning', learningRoutes)
  app.route('/api/campaigns', campaignRoutes)
  app.route('/api/swipe', swipeRoutes)

  // Serve static HTML pages
  app.get('/review', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'review.html'), 'utf-8')
    return c.html(html)
  })

  app.get('/swipe/:sessionId', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'swipe.html'), 'utf-8')
    return c.html(html)
  })

  app.get('/campaigns', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'campaigns.html'), 'utf-8')
    return c.html(html)
  })

  app.get('/campaigns/:id', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'campaign-detail.html'), 'utf-8')
    return c.html(html)
  })

  app.get('/monthly-report', (c) => {
    const html = readFileSync(join(__dirname, 'public', 'monthly-report.html'), 'utf-8')
    return c.html(html)
  })

  // Landing page
  app.get('/', (c) => {
    return c.html(`<!DOCTYPE html>
<html><head><title>GTM-OS</title>
<style>body{font-family:system-ui;background:#0f0f0f;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.container{text-align:center;max-width:400px}h1{font-size:2rem;margin-bottom:.5rem}
p{color:#888;margin-bottom:2rem}a{display:block;padding:1rem;margin:.5rem 0;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#f5c542;text-decoration:none;font-weight:600}
a:hover{background:#242424;border-color:#f5c542}</style></head>
<body><div class="container"><h1>GTM-OS</h1><p>Open-source GTM operating system</p>
<a href="/campaigns">Campaign Dashboard</a>
<a href="/review">Lead Review Dashboard</a>
<a href="/swipe/demo">Skill Optimization (RL)</a>
</div></body></html>`)
  })

  return app
}

export function startServer(port = 3847) {
  const app = createApp()
  console.log(`\nGTM-OS Server: http://localhost:${port}`)
  console.log('  /campaigns — Campaign dashboard')
  console.log('  /review    — Lead review dashboard')
  console.log('  /swipe     — Skill optimization\n')
  serve({ fetch: app.fetch, port })
}
