/**
 * Live Sync — Suppression Set Builder
 *
 * Before deduplication, pulls current state from all sources:
 *   - Active campaigns (campaignLeads table)
 *   - CRM (adapter.getSuppression())
 *   - Replied/booked leads
 *   - Lead blocklist
 *   - Optional Notion databases
 *
 * Builds a unified SuppressionEntry[] for the dedup engine.
 */

import { db } from '../db'
import { campaignLeads, campaigns, leadBlocklist } from '../db/schema'
import { eq } from 'drizzle-orm'
import type { SuppressionEntry, SuppressionSource } from './types'

/**
 * CRM adapter interface — minimal shape needed for suppression.
 * Uses a duck-typed interface to avoid hard dependency on the CRM module.
 */
interface CRMSuppressionProvider {
  getSuppression(): Promise<Set<string>>
}

// ─── Options ────────────────────────────────────────────────────────────────

export interface LiveSyncOptions {
  tenantId?: string
  /** Include leads from active campaigns */
  includeCampaigns?: boolean
  /** Include replied/demo_booked leads */
  includeReplied?: boolean
  /** Include CRM suppression (any object with getSuppression()) */
  crmAdapter?: CRMSuppressionProvider
  /** Include lead blocklist */
  includeBlocklist?: boolean
  /** External suppression list (e.g., from Notion/CSV) */
  externalEntries?: SuppressionEntry[]
}

// ─── Build Suppression Set ──────────────────────────────────────────────────

export async function buildSuppressionSet(
  opts: LiveSyncOptions = {},
): Promise<SuppressionEntry[]> {
  const entries: SuppressionEntry[] = []
  const tenantId = opts.tenantId ?? 'default'

  // 1. Active campaign leads
  if (opts.includeCampaigns !== false) {
    const campaignEntries = await getCampaignLeads(tenantId)
    entries.push(...campaignEntries)
  }

  // 2. Replied / demo_booked leads
  if (opts.includeReplied !== false) {
    const repliedEntries = await getRepliedLeads(tenantId)
    entries.push(...repliedEntries)
  }

  // 3. CRM suppression
  if (opts.crmAdapter) {
    try {
      const crmSuppression = await opts.crmAdapter.getSuppression()
      for (const item of crmSuppression) {
        // CRM suppression returns emails and domains
        entries.push({
          id: `crm:${item}`,
          email: item.includes('@') ? item : undefined,
          company: !item.includes('@') ? item : undefined,
          source: 'crm' as SuppressionSource,
        })
      }
    } catch (err) {
      console.warn(`[dedup] CRM suppression fetch failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 4. Lead blocklist
  if (opts.includeBlocklist !== false) {
    const blocklistEntries = await getBlocklistEntries(tenantId)
    entries.push(...blocklistEntries)
  }

  // 5. External entries (Notion, CSV, etc.)
  if (opts.externalEntries) {
    entries.push(...opts.externalEntries)
  }

  console.log(`[dedup] Built suppression set: ${entries.length} entries`)
  return entries
}

// ─── Data Source Fetchers ───────────────────────────────────────────────────

async function getCampaignLeads(tenantId: string): Promise<SuppressionEntry[]> {
  // Get active campaigns
  const activeCampaigns = await db.select()
    .from(campaigns)
    .where(eq(campaigns.tenantId, tenantId))

  const activeIds = activeCampaigns
    .filter(c => ['active', 'running', 'draft'].includes(c.status))
    .map(c => c.id)

  if (activeIds.length === 0) return []

  const leads = await db.select()
    .from(campaignLeads)
    .where(eq(campaignLeads.tenantId, tenantId))

  // Build a campaign title lookup
  const titleMap = new Map(activeCampaigns.map(c => [c.id, c.title]))

  return leads
    .filter(l => activeIds.includes(l.campaignId))
    .map(l => ({
      id: l.id,
      email: l.email ?? undefined,
      linkedin_url: l.linkedinUrl ?? undefined,
      first_name: l.firstName ?? undefined,
      last_name: l.lastName ?? undefined,
      headline: l.headline ?? undefined,
      company: l.company ?? undefined,
      source: 'campaign_active' as SuppressionSource,
      campaignId: l.campaignId,
      campaignTitle: titleMap.get(l.campaignId) ?? l.campaignId,
      lifecycleStatus: l.lifecycleStatus,
    }))
}

async function getRepliedLeads(tenantId: string): Promise<SuppressionEntry[]> {
  const leads = await db.select()
    .from(campaignLeads)
    .where(eq(campaignLeads.tenantId, tenantId))

  const repliedStatuses = ['Replied', 'Demo_Booked', 'Deal_Created', 'Closed_Won']

  return leads
    .filter(l => repliedStatuses.includes(l.lifecycleStatus))
    .map(l => ({
      id: l.id,
      email: l.email ?? undefined,
      linkedin_url: l.linkedinUrl ?? undefined,
      first_name: l.firstName ?? undefined,
      last_name: l.lastName ?? undefined,
      headline: l.headline ?? undefined,
      company: l.company ?? undefined,
      source: 'campaign_replied' as SuppressionSource,
      campaignId: l.campaignId,
      lifecycleStatus: l.lifecycleStatus,
    }))
}

async function getBlocklistEntries(tenantId: string): Promise<SuppressionEntry[]> {
  const blocklist = await db.select()
    .from(leadBlocklist)
    .where(eq(leadBlocklist.tenantId, tenantId))

  return blocklist.map(b => ({
    id: b.id,
    linkedin_url: b.linkedinUrl ?? undefined,
    first_name: b.name?.split(' ')[0] ?? undefined,
    last_name: b.name?.split(' ').slice(1).join(' ') ?? undefined,
    headline: b.headline ?? undefined,
    company: b.company ?? undefined,
    source: 'blocklist' as SuppressionSource,
  }))
}
