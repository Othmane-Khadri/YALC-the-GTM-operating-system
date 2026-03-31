import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { db } from '../../db'
import { webhooks } from '../../db/schema'

export const webhookRoutes = new Hono()

// List all webhooks
webhookRoutes.get('/', async (c) => {
  const all = await db.select().from(webhooks)
  return c.json({ webhooks: all })
})

// Register a new webhook
webhookRoutes.post('/', async (c) => {
  const body = await c.req.json<{ url: string; event: string; campaignId?: string }>()

  if (!body.url || !body.event) {
    return c.json({ error: 'url and event are required' }, 400)
  }

  const validEvents = ['lead.status_changed', 'campaign.completed', 'reply.received']
  if (!validEvents.includes(body.event)) {
    return c.json({ error: `event must be one of: ${validEvents.join(', ')}` }, 400)
  }

  const id = crypto.randomUUID()
  await db.insert(webhooks).values({
    id,
    url: body.url,
    event: body.event,
    campaignId: body.campaignId ?? null,
    active: 1,
  })

  return c.json({ ok: true, id }, 201)
})

// Delete a webhook
webhookRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const rows = await db.select().from(webhooks).where(eq(webhooks.id, id)).limit(1)
  if (rows.length === 0) return c.json({ error: 'Webhook not found' }, 404)

  await db.delete(webhooks).where(eq(webhooks.id, id))
  return c.json({ ok: true })
})
