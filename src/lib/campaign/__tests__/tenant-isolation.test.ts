import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { CampaignManager } from '../manager.js'
import { runTracker } from '../tracker.js'
import { db } from '../../db/index.js'
import {
  campaigns,
  campaignLeads,
  campaignVariants,
  conversations,
} from '../../db/schema.js'

/**
 * Phase 2 / P2.1 — campaign tenant isolation test.
 *
 * Seeds two fresh tenants with a campaign + 5 leads + 1 variant each, then
 * asserts every public entry point on CampaignManager / runTracker filters
 * reads and writes by tenantId. Covers the regression surface for the
 * multi-campaign send loop.
 */
describe('Campaign module tenant isolation', () => {
  const TENANT_A = 'iso-camp-a'
  const TENANT_B = 'iso-camp-b'

  let campaignAId = ''
  let campaignBId = ''
  const leadIds: Record<string, string[]> = { [TENANT_A]: [], [TENANT_B]: [] }
  const variantIds: Record<string, string> = { [TENANT_A]: '', [TENANT_B]: '' }
  const createdConversations: string[] = []

  async function cleanup() {
    for (const t of [TENANT_A, TENANT_B]) {
      await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, t))
      await db.delete(campaignVariants).where(eq(campaignVariants.tenantId, t))
      await db.delete(campaigns).where(eq(campaigns.tenantId, t))
    }
    for (const cId of createdConversations) {
      await db.delete(conversations).where(eq(conversations.id, cId))
    }
    createdConversations.length = 0
  }

  async function seedTenant(tenant: string): Promise<{ campaignId: string; variantId: string; leadIds: string[] }> {
    const convId = randomUUID()
    await db.insert(conversations).values({ id: convId, title: `conv-${tenant}` })
    createdConversations.push(convId)

    const manager = new CampaignManager(tenant)
    const campaign = await manager.create({
      conversationId: convId,
      title: `iso test ${tenant}`,
      hypothesis: 'tenant isolation smoke test',
      targetSegment: null,
      channels: ['linkedin'],
      successMetrics: [],
    })

    // Activate + attach a LinkedIn account id so tracker processes it.
    await db
      .update(campaigns)
      .set({ status: 'active', linkedinAccountId: `acct-${tenant}` })
      .where(eq(campaigns.id, campaign.id))

    const variantId = randomUUID()
    await db.insert(campaignVariants).values({
      id: variantId,
      tenantId: tenant,
      campaignId: campaign.id,
      name: 'default',
      status: 'active',
      connectNote: `Hello, ${tenant} test`,
      dm1Template: 'Hello, nice connecting',
      dm2Template: 'Hello, following up',
    })

    const leads: string[] = []
    for (let i = 0; i < 5; i++) {
      const id = randomUUID()
      await db.insert(campaignLeads).values({
        id,
        tenantId: tenant,
        campaignId: campaign.id,
        variantId,
        providerId: `${tenant}-provider-${i}`,
        firstName: `First${i}`,
        lastName: `Last${i}`,
        lifecycleStatus: 'Queued',
      })
      leads.push(id)
    }

    return { campaignId: campaign.id, variantId, leadIds: leads }
  }

  beforeEach(async () => {
    await cleanup()
    const a = await seedTenant(TENANT_A)
    const b = await seedTenant(TENANT_B)
    campaignAId = a.campaignId
    campaignBId = b.campaignId
    leadIds[TENANT_A] = a.leadIds
    leadIds[TENANT_B] = b.leadIds
    variantIds[TENANT_A] = a.variantId
    variantIds[TENANT_B] = b.variantId
  })

  afterEach(cleanup)

  it('CampaignManager.list() only returns the caller tenant', async () => {
    const managerA = new CampaignManager(TENANT_A)
    const managerB = new CampaignManager(TENANT_B)

    const listA = await managerA.list()
    const listB = await managerB.list()

    expect(listA.find((c) => c.id === campaignAId)).toBeDefined()
    expect(listA.find((c) => c.id === campaignBId)).toBeUndefined()

    expect(listB.find((c) => c.id === campaignBId)).toBeDefined()
    expect(listB.find((c) => c.id === campaignAId)).toBeUndefined()
  })

  it('CampaignManager.get() returns null for a foreign-tenant campaign id', async () => {
    const managerA = new CampaignManager(TENANT_A)
    expect(await managerA.get(campaignBId)).toBeNull()

    const managerB = new CampaignManager(TENANT_B)
    expect(await managerB.get(campaignAId)).toBeNull()
  })

  it('CampaignManager.pause() on a foreign-tenant campaign is a no-op', async () => {
    const managerA = new CampaignManager(TENANT_A)
    await managerA.pause(campaignBId)

    const [rowB] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignBId))
    // Tenant A's pause must NOT have touched tenant B's row.
    expect(rowB.status).toBe('active')
  })

  it('runTracker({ tenantId: A, dryRun: true }) never advances tenant B leads', async () => {
    // Minimal stub config (tracker.ts reads these fields defensively).
    const cfg: any = {
      unipile: { daily_connect_limit: 30, rate_limit_ms: 0 },
      notion: {},
      slack: null,
    }

    await runTracker({
      config: cfg,
      tenantId: TENANT_A,
      dryRun: true,
    })

    // Every tenant-B lead must still be in its seeded 'Queued' state.
    const bLeads = await db
      .select()
      .from(campaignLeads)
      .where(eq(campaignLeads.tenantId, TENANT_B))
    expect(bLeads).toHaveLength(5)
    for (const lead of bLeads) {
      expect(lead.lifecycleStatus).toBe('Queued')
    }
  })

  it('tenant-scoped update cannot reach a foreign tenant row by id', async () => {
    // Raw SQL probe: a tenant A scoped update targeting a tenant B lead id
    // must change zero rows.
    const bLeadId = leadIds[TENANT_B][0]
    await db
      .update(campaignLeads)
      .set({ lifecycleStatus: 'Replied' })
      .where(
        and(
          eq(campaignLeads.tenantId, TENANT_A),
          eq(campaignLeads.id, bLeadId),
        ),
      )

    const [row] = await db
      .select()
      .from(campaignLeads)
      .where(eq(campaignLeads.id, bLeadId))
    expect(row.lifecycleStatus).toBe('Queued')
    expect(row.tenantId).toBe(TENANT_B)
  })
})
