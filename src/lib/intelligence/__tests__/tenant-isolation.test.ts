import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { IntelligenceStore } from '../store.js'
import { db } from '../../db/index.js'
import { intelligence as intelligenceTable } from '../../db/schema.js'

/**
 * Phase 1 / A5 — tenant isolation test.
 *
 * Seeds intelligence rows into two tenants ('tenant-a' and 'test-co') and
 * asserts that each store instance sees only its own rows. This is the
 * regression gate for multi-tenancy — if any future query drops its
 * tenant scope, this test will surface cross-tenant bleed immediately.
 */
describe('IntelligenceStore tenant isolation', () => {
  const TENANT_A = 'tenant-a'
  const TENANT_B = 'iso-test-co'

  beforeEach(async () => {
    // Clean any residue from prior runs so the assertions are deterministic.
    await db.delete(intelligenceTable).where(eq(intelligenceTable.tenantId, TENANT_B))
  })

  it('reads and writes are partitioned by tenantId', async () => {
    const storeA = new IntelligenceStore(TENANT_A)
    const storeB = new IntelligenceStore(TENANT_B)

    const baseEvidence = [
      {
        type: 'unit-test',
        sourceId: 'unit-test',
        metric: 'count',
        value: 1,
        sampleSize: 1,
        timestamp: new Date().toISOString(),
      },
    ]

    const entryB = await storeB.add({
      category: 'qualification',
      insight: 'TENANT_B_ONLY — should never appear in tenant A queries',
      evidence: baseEvidence,
      segment: null,
      channel: null,
      confidence: 'hypothesis',
      source: 'external',
      biasCheck: null,
      supersedes: null,
      validatedAt: null,
      expiresAt: null,
    })

    // Store A must not see tenant B's entry
    const aQuery = await storeA.query({})
    expect(aQuery.find((r) => r.id === entryB.id)).toBeUndefined()
    expect(await storeA.get(entryB.id)).toBeNull()

    // Store B must see its own entry
    const bQuery = await storeB.query({})
    expect(bQuery.find((r) => r.id === entryB.id)).toBeDefined()
    expect(await storeB.get(entryB.id)).not.toBeNull()

    // Low-level sanity check: only TENANT_B rows exist for the seeded id
    const raw = await db
      .select()
      .from(intelligenceTable)
      .where(eq(intelligenceTable.id, entryB.id))
    expect(raw).toHaveLength(1)
    expect(raw[0].tenantId).toBe(TENANT_B)

    // Cleanup
    await db.delete(intelligenceTable).where(eq(intelligenceTable.id, entryB.id))
  })

  it('supersede/expire/updateConfidence cannot reach another tenant', async () => {
    const storeA = new IntelligenceStore(TENANT_A)
    const storeB = new IntelligenceStore(TENANT_B)

    const evidence = [
      {
        type: 'unit-test',
        sourceId: 'unit-test',
        metric: 'count',
        value: 1,
        sampleSize: 1,
        timestamp: new Date().toISOString(),
      },
    ]

    const entryB = await storeB.add({
      category: 'icp',
      insight: 'iso test entry',
      evidence,
      segment: null,
      channel: null,
      confidence: 'hypothesis',
      source: 'external',
      biasCheck: null,
      supersedes: null,
      validatedAt: null,
      expiresAt: null,
    })

    // Tenant A trying to expire a tenant-B row must be a no-op.
    await storeA.expire(entryB.id)
    const stillActive = await storeB.get(entryB.id)
    expect(stillActive).not.toBeNull()
    expect(stillActive!.expiresAt).toBeNull()

    // Tenant B legitimately expires it.
    await storeB.expire(entryB.id)
    const expired = await storeB.get(entryB.id)
    expect(expired!.expiresAt).not.toBeNull()

    // Cleanup
    await db.delete(intelligenceTable).where(eq(intelligenceTable.id, entryB.id))
  })
})

// ─── Phase 2 / P2.1 extension — campaigns table regression gate ──────────
describe('A5 regression — campaign tables stay tenant-scoped', () => {
  it('a campaigns row seeded with tenant B is invisible via CampaignManager(tenantA).list()', async () => {
    const { CampaignManager } = await import('../../campaign/manager.js')
    const { campaigns, campaignLeads, conversations } = await import('../../db/schema.js')
    const { randomUUID } = await import('crypto')

    const TENANT_A = 'a5-regress-a'
    const TENANT_B = 'a5-regress-b'

    // Cleanup residue
    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT_A))
    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT_B))
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT_A))
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT_B))

    const convAId = randomUUID()
    const convBId = randomUUID()
    await db.insert(conversations).values([
      { id: convAId, title: 'a5 a' },
      { id: convBId, title: 'a5 b' },
    ])

    const campaignB = await new CampaignManager(TENANT_B).create({
      conversationId: convBId,
      title: 'tenant B exclusive',
      hypothesis: 'a5 regression',
      targetSegment: null,
      channels: ['linkedin'],
      successMetrics: [],
    })

    const listA = await new CampaignManager(TENANT_A).list()
    expect(listA.find((c) => c.id === campaignB.id)).toBeUndefined()

    // Low-level sanity check
    const raw = await db.select().from(campaigns).where(eq(campaigns.id, campaignB.id))
    expect(raw).toHaveLength(1)
    expect(raw[0].tenantId).toBe(TENANT_B)

    // Cleanup
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT_B))
    await db.delete(conversations).where(eq(conversations.id, convAId))
    await db.delete(conversations).where(eq(conversations.id, convBId))
  })

  it('a campaignLeads row seeded with tenant B is invisible from a tenant-scoped select', async () => {
    const { CampaignManager } = await import('../../campaign/manager.js')
    const { campaigns, campaignLeads, conversations } = await import('../../db/schema.js')
    const { randomUUID } = await import('crypto')

    const TENANT_A = 'a5-leads-a'
    const TENANT_B = 'a5-leads-b'

    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT_A))
    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT_B))
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT_B))

    // Seed a real tenant-B campaign (campaigns row) for the FK target.
    const convId = randomUUID()
    await db.insert(conversations).values({ id: convId, title: 'a5-leads-b' })

    const campB = await new CampaignManager(TENANT_B).create({
      conversationId: convId,
      title: 'a5 leads parent',
      hypothesis: 'a5 regression',
      targetSegment: null,
      channels: ['linkedin'],
      successMetrics: [],
    })

    const bLeadId = randomUUID()
    await db.insert(campaignLeads).values({
      id: bLeadId,
      tenantId: TENANT_B,
      campaignId: campB.id,
      providerId: 'b-provider',
      firstName: 'B',
      lastName: 'Tenant',
      lifecycleStatus: 'Queued',
    })

    const aQueried = await db
      .select()
      .from(campaignLeads)
      .where(eq(campaignLeads.tenantId, TENANT_A))
    expect(aQueried.find((l) => l.id === bLeadId)).toBeUndefined()

    const bQueried = await db
      .select()
      .from(campaignLeads)
      .where(eq(campaignLeads.tenantId, TENANT_B))
    expect(bQueried.find((l) => l.id === bLeadId)).toBeDefined()

    // Cleanup
    await db.delete(campaignLeads).where(eq(campaignLeads.tenantId, TENANT_B))
    await db.delete(campaigns).where(eq(campaigns.tenantId, TENANT_B))
    await db.delete(conversations).where(eq(conversations.id, convId))
  })
})
