import { eq, and, or, isNull } from 'drizzle-orm'
import { db } from '../db'
import { webhooks } from '../db/schema'

export async function fireWebhooks(
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const campaignId = payload.campaignId as string | undefined

  // Find matching webhooks: active + matching event + (matching campaign OR global)
  const conditions = [
    eq(webhooks.active, 1),
    eq(webhooks.event, event),
  ]

  const matchingWebhooks = await db
    .select()
    .from(webhooks)
    .where(and(...conditions))

  // Filter in JS to handle campaignId matching (global or specific)
  const filtered = matchingWebhooks.filter(
    (w) => !w.campaignId || w.campaignId === campaignId,
  )

  for (const webhook of filtered) {
    // Fire-and-forget
    fetch(webhook.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() }),
    }).catch((err) => {
      console.error(`[webhooks] Failed to fire webhook ${webhook.id} to ${webhook.url}:`, err)
    })
  }
}
