import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { hasReplied } from '../blocklist.js'
import { db } from '../../db/index.js'
import {
  campaigns,
  campaignLeads,
  leadBlocklist,
  conversations,
} from '../../db/schema.js'
import { CampaignManager } from '../manager.js'

/**
 * Phase 2 / P2.2 — reply-detection blocklist tests.
 *
 * Covers all three reply-signal paths that must block a subsequent
 * send to the same prospect:
 *   1. LinkedIn reply  (campaign_leads.replied_at)
 *   2. Email reply     (campaign_leads.email_replied_at)
 *   3. Explicit permanent blocklist row (lead_blocklist.scope='permanent')
 */
describe('campaign blocklist — hasReplied', () => {
  const TENANT = 'blocklist-test'
  let campaignId = ''
  const convIds: string[] = []

  async function cleanup() {
    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT))
    await db.delete(leadBlocklist).where(eq(leadBlocklist.tenantId, TENANT))
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT))
    for (const id of convIds) {
      await db.delete(conversations).where(eq(conversations.id, id))
    }
    convIds.length = 0
  }

  beforeEach(async () => {
    await cleanup()
    const convId = randomUUID()
    await db.insert(conversations).values({ id: convId, title: 'blocklist test' })
    convIds.push(convId)

    const manager = new CampaignManager(TENANT)
    const c = await manager.create({
      conversationId: convId,
      title: 'blocklist parent',
      hypothesis: 'test',
      targetSegment: null,
      channels: ['linkedin'],
      successMetrics: [],
    })
    campaignId = c.id
  })

  afterEach(cleanup)

  it('blocks a subsequent send when the prospect already has a LinkedIn reply', async () => {
    const providerId = 'li-provider-123'
    await db.insert(campaignLeads).values({
      id: randomUUID(),
      tenantId: TENANT,
      campaignId,
      providerId,
      firstName: 'Li',
      lastName: 'Replied',
      lifecycleStatus: 'Replied',
      repliedAt: new Date().toISOString(),
    })

    const blocked = await hasReplied(TENANT, { providerId }, { campaignId })
    expect(blocked).toBe(true)
  })

  it('blocks a subsequent send when the prospect already has an email reply', async () => {
    const email = 'replied@example.com'
    await db.insert(campaignLeads).values({
      id: randomUUID(),
      tenantId: TENANT,
      campaignId,
      providerId: 'li-other',
      firstName: 'Em',
      lastName: 'Replied',
      email,
      lifecycleStatus: 'Replied',
      emailRepliedAt: new Date().toISOString(),
    })

    const blocked = await hasReplied(TENANT, { email }, { campaignId })
    expect(blocked).toBe(true)
  })

  it('blocks when the prospect is on the permanent lead_blocklist', async () => {
    const providerId = 'li-permablock'
    await db.insert(leadBlocklist).values({
      id: randomUUID(),
      tenantId: TENANT,
      providerId,
      scope: 'permanent',
      reason: 'manually excluded',
    })

    const blocked = await hasReplied(TENANT, { providerId }, { campaignId })
    expect(blocked).toBe(true)
  })

  it('does NOT block a fresh prospect with no reply history', async () => {
    const blocked = await hasReplied(
      TENANT,
      { providerId: 'fresh-lead', linkedinUrl: 'https://linkedin.com/in/fresh', email: 'fresh@ex.com' },
      { campaignId },
    )
    expect(blocked).toBe(false)
  })

  it('does not see cross-tenant reply history', async () => {
    const providerId = 'li-cross-tenant'
    // Seed a reply in a different tenant
    const otherTenant = 'blocklist-other-tenant'
    const otherConv = randomUUID()
    await db.insert(conversations).values({ id: otherConv, title: 'other' })
    convIds.push(otherConv)
    const otherCamp = await new CampaignManager(otherTenant).create({
      conversationId: otherConv,
      title: 'other',
      hypothesis: 'x',
      targetSegment: null,
      channels: ['linkedin'],
      successMetrics: [],
    })
    await db.insert(campaignLeads).values({
      id: randomUUID(),
      tenantId: otherTenant,
      campaignId: otherCamp.id,
      providerId,
      firstName: 'X',
      lastName: 'Tenant',
      lifecycleStatus: 'Replied',
      repliedAt: new Date().toISOString(),
    })

    try {
      const blocked = await hasReplied(TENANT, { providerId }, { campaignId })
      expect(blocked).toBe(false)
    } finally {
      await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, otherTenant))
      await db.delete(campaigns).where(eq(campaigns.tenantId, otherTenant))
    }
  })
})
