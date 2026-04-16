import { Hono } from 'hono'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SESSION_DIR = join(tmpdir(), 'gtm-os-rl-sessions')

export const swipeRoutes = new Hono()

// Get samples for a swipe session
swipeRoutes.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const samplesPath = join(SESSION_DIR, sessionId, 'samples.json')

  if (!existsSync(samplesPath)) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const data = JSON.parse(readFileSync(samplesPath, 'utf-8'))
  return c.json(data)
})

// Submit swipe results
swipeRoutes.post('/:sessionId/results', async (c) => {
  const sessionId = c.req.param('sessionId')
  const sessionDir = join(SESSION_DIR, sessionId)
  const resultsPath = join(sessionDir, 'results.json')

  if (!existsSync(join(sessionDir, 'samples.json'))) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const body = await c.req.json()
  writeFileSync(resultsPath, JSON.stringify(body, null, 2))

  return c.json({ ok: true, message: 'Results saved' })
})
