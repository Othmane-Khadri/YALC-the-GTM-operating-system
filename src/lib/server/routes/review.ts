import { Hono } from 'hono'
import { ReviewQueue } from '../../review/queue'
import type { ReviewType, ReviewPriority } from '../../review/types'
import { db } from '../../db'
import { leadBlocklist } from '../../db/schema'
import { eq, or } from 'drizzle-orm'
import { randomUUID } from 'crypto'

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

// ─── Blocklist endpoints ─────────────────────────────────────────────────────

// List all blocklisted leads
reviewRoutes.get('/blocklist', async (c) => {
  const scope = c.req.query('scope') // 'permanent' | 'campaign' | undefined (all)
  let items
  if (scope) {
    items = await db.select().from(leadBlocklist).where(eq(leadBlocklist.scope, scope as 'permanent' | 'campaign'))
  } else {
    items = await db.select().from(leadBlocklist)
  }
  return c.json({ items, count: items.length })
})

// Add to blocklist (single or batch)
reviewRoutes.post('/blocklist', async (c) => {
  const body = await c.req.json() as {
    leads: Array<{
      provider_id?: string
      linkedin_url?: string
      linkedin_slug?: string
      name?: string
      headline?: string
      company?: string
      reason?: string
    }>
    scope: 'permanent' | 'campaign'
    campaign_id?: string
  }

  const created = []
  for (const lead of body.leads) {
    // Check if already blocklisted
    const existing = await db.select().from(leadBlocklist).where(
      or(
        lead.provider_id ? eq(leadBlocklist.providerId, lead.provider_id) : undefined,
        lead.linkedin_slug ? eq(leadBlocklist.linkedinSlug, lead.linkedin_slug) : undefined,
      )
    )
    if (existing.length > 0) continue

    const row = {
      id: randomUUID(),
      providerId: lead.provider_id || null,
      linkedinUrl: lead.linkedin_url || null,
      linkedinSlug: lead.linkedin_slug || null,
      name: lead.name || null,
      headline: lead.headline || null,
      company: lead.company || null,
      scope: body.scope,
      campaignId: body.campaign_id || null,
      reason: lead.reason || null,
    }
    await db.insert(leadBlocklist).values(row)
    created.push(row)
  }

  return c.json({ created: created.length, total_blocklisted: (await db.select().from(leadBlocklist)).length })
})

// Remove from blocklist
reviewRoutes.delete('/blocklist/:id', async (c) => {
  await db.delete(leadBlocklist).where(eq(leadBlocklist.id, c.req.param('id')))
  return c.json({ success: true })
})

// Check if a lead is blocklisted
reviewRoutes.get('/blocklist/check', async (c) => {
  const providerId = c.req.query('provider_id')
  const slug = c.req.query('slug')

  if (!providerId && !slug) return c.json({ blocked: false })

  const matches = await db.select().from(leadBlocklist).where(
    or(
      providerId ? eq(leadBlocklist.providerId, providerId) : undefined,
      slug ? eq(leadBlocklist.linkedinSlug, slug) : undefined,
    )
  )

  return c.json({ blocked: matches.length > 0, entries: matches })
})
