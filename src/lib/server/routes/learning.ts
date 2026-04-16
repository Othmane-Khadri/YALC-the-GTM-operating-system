import { Hono } from 'hono'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export const learningRoutes = new Hono()

const SESSION_DIR = join(tmpdir(), 'gtm-os-rl-sessions')

// Get samples for a session
learningRoutes.get('/sessions/:id/samples', (c) => {
  const sessionDir = join(SESSION_DIR, c.req.param('id'))
  const samplesPath = join(sessionDir, 'samples.json')

  if (!existsSync(samplesPath)) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const samples = JSON.parse(readFileSync(samplesPath, 'utf-8'))
  return c.json(samples)
})

// Save swipe results for a session
learningRoutes.post('/sessions/:id/results', async (c) => {
  const sessionId = c.req.param('id')
  const sessionDir = join(SESSION_DIR, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  const body = await c.req.json()
  const resultsPath = join(sessionDir, 'results.json')
  writeFileSync(resultsPath, JSON.stringify(body, null, 2))

  return c.json({ saved: true, sessionId })
})

// Create a new session (called by the optimize-skill)
learningRoutes.post('/sessions', async (c) => {
  const { sessionId, samples } = await c.req.json() as {
    sessionId: string
    samples: unknown[]
  }

  const sessionDir = join(SESSION_DIR, sessionId)
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(
    join(sessionDir, 'samples.json'),
    JSON.stringify(samples, null, 2)
  )

  return c.json({ sessionId, sampleCount: samples.length })
})

// Get results for analysis
learningRoutes.get('/sessions/:id/results', (c) => {
  const resultsPath = join(SESSION_DIR, c.req.param('id'), 'results.json')

  if (!existsSync(resultsPath)) {
    return c.json({ error: 'Results not found' }, 404)
  }

  const results = JSON.parse(readFileSync(resultsPath, 'utf-8'))
  return c.json(results)
})
