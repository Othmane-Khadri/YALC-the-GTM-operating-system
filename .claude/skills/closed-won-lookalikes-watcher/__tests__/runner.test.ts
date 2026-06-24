/**
 * closed-won-lookalikes-watcher runner — behavioral tests.
 *
 * Mocks HubSpot, find-lookalikes, FullEnrich, dedup, and Slack. Verifies:
 *   1. 12 closed-won deals → one intelligence-store hypothesis with
 *      category 'icp' and confidence 'hypothesis'.
 *   2. find-lookalikes is invoked once per UNIQUE anchor domain.
 *   3. Default top_n (50) and override top_n (e.g. 7) are honored.
 *   4. Empty closed-won → skipped run with empty digest, no enrich call.
 *   5. Dedup suppression removes matches before trimming to top_n.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db, rawClient } from '../../../../src/lib/db'
import { intelligence as intelligenceTable } from '../../../../src/lib/db/schema'
import { IntelligenceStore } from '../../../../src/lib/intelligence/store'
import {
  runClosedWonLookalikesWatcher,
  uniqueDomains,
  mergeAndRank,
  synthesizeIcpPattern,
  deriveEffectiveTopN,
  DEFAULT_COST_PER_ENRICHMENT_USD,
  AUTO_MAX_CAP,
  LEGACY_DEFAULT_TOP_N,
  type ClosedWonDeal,
  type ClosedWonLookalikesConfig,
  type EnrichedLead,
  type LookalikeCandidate,
  type SuppressionLike,
} from '../../../../src/lib/agents/closed-won-lookalikes-watcher'

const TEST_TENANT = `test-cwlw-${randomUUID().slice(0, 8)}`

beforeAll(async () => {
  // Defensive: schema may already exist from migrations; ignore failures.
  try {
    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS intelligence (
        id text PRIMARY KEY NOT NULL,
        tenant_id text NOT NULL DEFAULT 'default',
        category text NOT NULL,
        insight text NOT NULL,
        evidence text NOT NULL,
        segment text,
        channel text,
        confidence text NOT NULL DEFAULT 'hypothesis',
        confidence_score integer DEFAULT 0,
        source text NOT NULL,
        bias_check text,
        supersedes text,
        created_at text DEFAULT (datetime('now')),
        validated_at text,
        expires_at text
      )
    `)
  } catch {
    // ignore
  }
})

beforeEach(async () => {
  await db
    .delete(intelligenceTable)
    .where(eq(intelligenceTable.tenantId, TEST_TENANT))
})

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeConfig(
  overrides: Partial<ClosedWonLookalikesConfig> = {},
): ClosedWonLookalikesConfig {
  return {
    version: 1,
    hubspot: { dealstage: 'closedwon' },
    lookback_days: 7,
    max_anchor_domains: 10,
    // Legacy default behavior: unlimited budget + auto max_n = 50 effective.
    budget_usd: 'unlimited',
    max_n: 'auto',
    cost_per_enrichment_usd: DEFAULT_COST_PER_ENRICHMENT_USD,
    slack_delivery: { mode: 'mcp_user', target: 'U_TEST' },
    ...overrides,
  }
}

function makeDeals(n: number): ClosedWonDeal[] {
  // 12 deals across 4 unique domains (3 deals each). Industries skew B2B SaaS.
  const domains = ['acme.io', 'bolt.com', 'cinder.app', 'delta.so']
  const titles = ['VP Marketing', 'Head of Growth', 'CRO']
  return Array.from({ length: n }).map((_, i) => ({
    dealId: `deal-${i}`,
    name: `Deal ${i}`,
    amount: String(1000 * (i + 1)),
    closeDate: '2026-06-01',
    domain: domains[i % domains.length],
    industry: i % 2 === 0 ? 'B2B SaaS' : 'B2B SaaS',
    headcount: 120,
    buyerTitle: titles[i % titles.length],
  }))
}

function makeLookalikes(anchorDomain: string, n: number): LookalikeCandidate[] {
  return Array.from({ length: n }).map((_, i) => ({
    domain: `lookalike-${anchorDomain.replace(/[^a-z]/g, '')}-${i}.com`,
    companyName: `Lookalike ${anchorDomain} ${i}`,
    similarityScore: 1 - i * 0.01,
    anchorDomain,
  }))
}

const NEVER_SUPPRESSED: SuppressionLike = { isSuppressed: () => false }

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('runClosedWonLookalikesWatcher', () => {
  it('writes a hypothesis with category=icp and confidence=hypothesis when 12 deals come back', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const sendSlack = vi.fn().mockResolvedValue(undefined)
    const findLookalikes = vi
      .fn()
      .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 5))
    const enrich = vi.fn().mockImplementation(async (cands: LookalikeCandidate[]) =>
      cands.map<EnrichedLead>((c) => ({
        domain: c.domain,
        companyName: c.companyName ?? c.domain,
        buyerTitle: 'VP Growth',
        email: `info@${c.domain}`,
        phone: '+15555550001',
      })),
    )

    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig(),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes,
      enrichWithFullEnrich: enrich,
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: sendSlack,
    })

    expect(result.dealsFound).toBe(12)
    expect(result.skipped).toBe(false)
    expect(result.hypothesisId).toBeTruthy()

    // Exactly one intelligence row, with category icp + confidence hypothesis.
    const rows = await store.query({ category: 'icp' })
    const mine = rows.filter((r) => r.id === result.hypothesisId)
    expect(mine.length).toBe(1)
    expect(mine[0].category).toBe('icp')
    expect(mine[0].confidence).toBe('hypothesis')
    expect(mine[0].source).toBe('campaign_outcome')
    expect(mine[0].evidence.length).toBe(12)
    expect(mine[0].evidence[0].type).toBe('closed_won_deal')
  })

  it('invokes find-lookalikes once per UNIQUE anchor domain', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const findLookalikes = vi
      .fn()
      .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 3))

    await runClosedWonLookalikesWatcher({
      config: makeConfig(),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes,
      enrichWithFullEnrich: vi
        .fn()
        .mockImplementation(async (cands: LookalikeCandidate[]) =>
          cands.map<EnrichedLead>((c) => ({
            domain: c.domain,
            companyName: c.companyName ?? c.domain,
            buyerTitle: 'CRO',
            email: `x@${c.domain}`,
            phone: '+1',
          })),
        ),
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: vi.fn().mockResolvedValue(undefined),
    })

    // 12 deals × 4 unique domains.
    expect(findLookalikes).toHaveBeenCalledTimes(4)
    const calledWith = findLookalikes.mock.calls.map((c) => c[0]).sort()
    expect(calledWith).toEqual(['acme.io', 'bolt.com', 'cinder.app', 'delta.so'])
  })

  it('respects the default top_n=50 cap when more lookalikes are returned', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const sendSlack = vi.fn().mockResolvedValue(undefined)

    // Each anchor returns 200 lookalikes → 800 total candidates.
    const findLookalikes = vi
      .fn()
      .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 200))
    const enrich = vi.fn().mockImplementation(async (cands: LookalikeCandidate[]) =>
      cands.map<EnrichedLead>((c) => ({
        domain: c.domain,
        companyName: c.companyName ?? c.domain,
        buyerTitle: 'CMO',
        email: `info@${c.domain}`,
        phone: '+1',
      })),
    )

    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig(),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes,
      enrichWithFullEnrich: enrich,
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: sendSlack,
    })

    // Pool is top_n * 2 = 100, dedup keeps all, digest trims to 50.
    expect(enrich).toHaveBeenCalledOnce()
    expect(enrich.mock.calls[0][0].length).toBe(100)
    expect(result.digestRows).toBe(50)
  })

  it('respects a configured max_n override (max_n=7 -> 7 digest rows)', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig({ max_n: 7 }),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes: vi
        .fn()
        .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 50)),
      enrichWithFullEnrich: async (cands) =>
        cands.map<EnrichedLead>((c) => ({
          domain: c.domain,
          companyName: c.companyName ?? c.domain,
          buyerTitle: 'VP Sales',
          email: `info@${c.domain}`,
          phone: '+1',
        })),
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: vi.fn().mockResolvedValue(undefined),
    })

    expect(result.digestRows).toBe(7)
  })

  it('skips enrichment and sends an empty digest when no deals returned', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const findLookalikes = vi.fn()
    const enrich = vi.fn()
    const sendSlack = vi.fn().mockResolvedValue(undefined)

    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig(),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue([]),
      findLookalikes,
      enrichWithFullEnrich: enrich,
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: sendSlack,
    })

    expect(result.skipped).toBe(true)
    expect(result.skipReason).toBe('no_closed_won_deals')
    expect(findLookalikes).not.toHaveBeenCalled()
    expect(enrich).not.toHaveBeenCalled()
    expect(sendSlack).toHaveBeenCalledOnce()
  })

  it('removes suppression matches before trimming to top_n', async () => {
    const store = new IntelligenceStore(TEST_TENANT)

    // Build a suppression set that swallows the first 60 enriched leads.
    const blockedDomains = new Set<string>()
    const enrich = vi.fn().mockImplementation(async (cands: LookalikeCandidate[]) => {
      const leads = cands.map<EnrichedLead>((c) => ({
        domain: c.domain,
        companyName: c.companyName ?? c.domain,
        buyerTitle: 'CMO',
        email: `info@${c.domain}`,
        phone: '+1',
      }))
      for (const l of leads.slice(0, 60)) blockedDomains.add(l.domain)
      return leads
    })

    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig({ max_n: 50 }),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes: vi
        .fn()
        .mockImplementation(async (anchor) => makeLookalikes(anchor, 200)),
      enrichWithFullEnrich: enrich,
      buildSuppression: async () => ({
        isSuppressed: (lead) => blockedDomains.has(lead.domain),
      }),
      sendSlackDigest: vi.fn().mockResolvedValue(undefined),
    })

    // Pool = 100, 60 blocked, 40 survivors. top_n cap = 50, but only 40 survive.
    expect(result.dedupedOut).toBe(60)
    expect(result.digestRows).toBe(40)
  })
})

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe('uniqueDomains', () => {
  it('collapses repeats and normalizes case', () => {
    const deals: ClosedWonDeal[] = [
      { dealId: '1', domain: 'Acme.io' },
      { dealId: '2', domain: 'acme.io' },
      { dealId: '3', domain: 'bolt.com' },
      { dealId: '4', domain: '' },
    ]
    expect(uniqueDomains(deals)).toEqual(['acme.io', 'bolt.com'])
  })
})

describe('mergeAndRank', () => {
  it('sums per-anchor similarity scores and sorts descending', () => {
    const rows: LookalikeCandidate[] = [
      { domain: 'a.com', similarityScore: 0.5, anchorDomain: 'anchor1' },
      { domain: 'a.com', similarityScore: 0.5, anchorDomain: 'anchor2' },
      { domain: 'b.com', similarityScore: 0.9, anchorDomain: 'anchor1' },
    ]
    const out = mergeAndRank(rows)
    expect(out[0].domain).toBe('a.com') // 1.0 vs 0.9
    expect(out[1].domain).toBe('b.com')
    expect(out.length).toBe(2)
  })
})

describe('synthesizeIcpPattern', () => {
  it('builds segment + evidence rows from deals', () => {
    const deals = makeDeals(6)
    const p = synthesizeIcpPattern(deals)
    expect(p.evidence.length).toBe(6)
    expect(p.evidence[0].type).toBe('closed_won_deal')
    expect(p.segment).toContain('50-199')
    expect(p.insight.toLowerCase()).toContain('b2b saas')
  })
})

// ─── Budget-aware effective top-N ──────────────────────────────────────────

describe('deriveEffectiveTopN', () => {
  it('budget=25, max_n=auto -> floor(25/0.30) = 83', () => {
    const cfg = makeConfig({ budget_usd: 25, max_n: 'auto' })
    expect(deriveEffectiveTopN(cfg)).toBe(83)
  })

  it('budget=25, max_n=10 -> min(10, 83) = 10', () => {
    const cfg = makeConfig({ budget_usd: 25, max_n: 10 })
    expect(deriveEffectiveTopN(cfg)).toBe(10)
  })

  it('budget=25, max_n=200 -> min(200, 83) = 83', () => {
    const cfg = makeConfig({ budget_usd: 25, max_n: 200 })
    expect(deriveEffectiveTopN(cfg)).toBe(83)
  })

  it('budget=unlimited, max_n=auto -> legacy default 50', () => {
    const cfg = makeConfig({ budget_usd: 'unlimited', max_n: 'auto' })
    expect(deriveEffectiveTopN(cfg)).toBe(LEGACY_DEFAULT_TOP_N)
  })

  it('budget=unlimited, max_n=number -> max_n unchanged', () => {
    const cfg = makeConfig({ budget_usd: 'unlimited', max_n: 17 })
    expect(deriveEffectiveTopN(cfg)).toBe(17)
  })

  it('budget=10000, max_n=auto -> capped at AUTO_MAX_CAP', () => {
    const cfg = makeConfig({ budget_usd: 10000, max_n: 'auto' })
    expect(deriveEffectiveTopN(cfg)).toBe(AUTO_MAX_CAP)
  })

  it('budget=0 -> effective_n = 0', () => {
    const cfg = makeConfig({ budget_usd: 0, max_n: 'auto' })
    expect(deriveEffectiveTopN(cfg)).toBe(0)
  })

  it('respects a tenant override of cost_per_enrichment_usd', () => {
    const cfg = makeConfig({
      budget_usd: 30,
      max_n: 'auto',
      cost_per_enrichment_usd: 0.5,
    })
    // floor(30 / 0.50) = 60
    expect(deriveEffectiveTopN(cfg)).toBe(60)
  })
})

describe('runner respects derived effective_n', () => {
  it('budget=25 + max_n=auto + 0.30/lead -> 83 digest rows (and 166 enrich pool)', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const findLookalikes = vi
      .fn()
      .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 200))
    const enrich = vi.fn().mockImplementation(async (cands: LookalikeCandidate[]) =>
      cands.map<EnrichedLead>((c) => ({
        domain: c.domain,
        companyName: c.companyName ?? c.domain,
        buyerTitle: 'CRO',
        email: `info@${c.domain}`,
        phone: '+1',
      })),
    )

    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig({ budget_usd: 25, max_n: 'auto' }),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes,
      enrichWithFullEnrich: enrich,
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: vi.fn().mockResolvedValue(undefined),
    })

    // effective_n = floor(25 / 0.30) = 83.
    expect(result.digestRows).toBe(83)
    // Enrich pool = effective_n * 2 = 166.
    expect(enrich.mock.calls[0][0].length).toBe(166)
  })

  it('budget=unlimited + max_n=7 -> 7 digest rows', async () => {
    const store = new IntelligenceStore(TEST_TENANT)
    const result = await runClosedWonLookalikesWatcher({
      config: makeConfig({ budget_usd: 'unlimited', max_n: 7 }),
      tenantId: TEST_TENANT,
      store,
      fetchHubspotClosedWon: vi.fn().mockResolvedValue(makeDeals(12)),
      findLookalikes: vi
        .fn()
        .mockImplementation(async (anchor: string) => makeLookalikes(anchor, 50)),
      enrichWithFullEnrich: async (cands) =>
        cands.map<EnrichedLead>((c) => ({
          domain: c.domain,
          companyName: c.companyName ?? c.domain,
          buyerTitle: 'VP Sales',
          email: `info@${c.domain}`,
          phone: '+1',
        })),
      buildSuppression: async () => NEVER_SUPPRESSED,
      sendSlackDigest: vi.fn().mockResolvedValue(undefined),
    })
    expect(result.digestRows).toBe(7)
  })
})

// ─── No subprocess spawn anywhere in the runner ───────────────────────────

describe('runner is fully in-process', () => {
  it('runner source does NOT reference child_process.spawn or shell-out exec', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(
      join(
        process.cwd(),
        'src',
        'lib',
        'agents',
        'closed-won-lookalikes-watcher.ts',
      ),
      'utf-8',
    )
    expect(src).not.toMatch(/from\s+['"]node:child_process['"]/)
    expect(src).not.toMatch(/child_process/)
    expect(src).not.toMatch(/\bspawn\s*\(/)
    expect(src).not.toMatch(/\bexec\s*\(/)
    expect(src).not.toMatch(/npx\s+tsx\s+src\/cli\/index\.ts\s+signals:similar/)
  })
})
