import { Hono } from 'hono'
import { ReviewQueue } from '../../review/queue'
import type { ReviewType, ReviewPriority } from '../../review/types'

const queue = new ReviewQueue()

export const reviewRoutes = new Hono()

// List review items (with optional filters)
reviewRoutes.get('/leads', async (c) => {
  const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined
  const type = c.req.query('type') as ReviewType | undefined
  const priority = c.req.query('priority') as ReviewPriority | undefined

  const items = await queue.list({ status, type, priority })
  const counts = await queue.getPendingCount()

  return c.json({ items, pendingCounts: counts })
})

// Get single review item
reviewRoutes.get('/leads/:id', async (c) => {
  const item = await queue.get(c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

// Approve a review item
reviewRoutes.post('/leads/:id/approve', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = await queue.approve(c.req.param('id'), body.notes)
  return c.json(result)
})

// Reject a review item
reviewRoutes.post('/leads/:id/reject', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const result = await queue.reject(c.req.param('id'), body.notes)
  return c.json(result)
})

// Dismiss a review item
reviewRoutes.post('/leads/:id/dismiss', async (c) => {
  await queue.dismiss(c.req.param('id'))
  return c.json({ success: true })
})

// Bulk reject (exclude) multiple items
reviewRoutes.post('/leads/bulk-reject', async (c) => {
  const { ids, notes } = await c.req.json() as { ids: string[]; notes?: string }
  const results = await Promise.all(ids.map(id => queue.reject(id, notes)))
  return c.json({ rejected: results.length })
})

// Ingest leads for review (create review items from a JSON array)
reviewRoutes.post('/leads/ingest', async (c) => {
  const { leads, source } = await c.req.json() as {
    leads: Array<{
      name: string
      title?: string
      company?: string
      score: number
      profile_url?: string
      [key: string]: unknown
    }>
    source: string
  }

  const created = []
  for (const lead of leads) {
    const item = await queue.create({
      type: 'lead_qualification' as ReviewType,
      title: lead.name,
      description: `${lead.title || ''} @ ${lead.company || 'Unknown'} — Score: ${lead.score}`,
      sourceSystem: source,
      sourceId: lead.profile_url || lead.name,
      priority: lead.score >= 95 ? 'high' : 'normal',
      payload: lead as Record<string, unknown>,
      action: null,
      nudgeEvidence: null,
      reviewedAt: null,
      reviewNotes: null,
      expiresAt: null,
    })
    created.push(item)
  }

  return c.json({ created: created.length })
})
