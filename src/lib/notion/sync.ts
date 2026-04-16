import { eq } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants } from '../db/schema'
import { notionService } from '../services/notion'
import { IntelligenceStore } from '../intelligence/store'
import type { GTMOSConfig } from '../config/types'
import { resolveTenant } from '../tenant'

interface SyncOptions {
  config: GTMOSConfig
  direction: string // 'push' | 'pull' | 'both'
  dryRun?: boolean
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runSync(opts: SyncOptions): Promise<void> {
  const { config, direction } = opts
  console.log(`[sync] Starting Notion sync (direction: ${direction})`)

  if (direction === 'push' || direction === 'both') {
    await pushLeadsToNotion(config)
    await syncCampaignMetricsToNotion(config)
    console.log('[sync] Pushed campaign metrics to Notion')
    await syncVariantStatsToNotion(config)
    console.log('[sync] Pushed variant stats to Notion')
  }

  if (direction === 'pull' || direction === 'both') {
    await pullNotionEdits(config)
  }

  console.log('[sync] Done.')
}

// ─── Push: Lead status → Notion ──────────────────────────────────────────────

export async function syncLeadToNotion(
  lead: typeof campaignLeads.$inferSelect,
  config: GTMOSConfig,
): Promise<void> {
  if (!lead.notionPageId) return

  const properties: Record<string, unknown> = {
    'Lifecycle Status': { select: { name: lead.lifecycleStatus } },
  }

  if (lead.connectSentAt) {
    properties['Connect Sent At'] = {
      date: { start: lead.connectSentAt.slice(0, 10) },
    }
  }
  if (lead.connectedAt) {
    properties['Connected At'] = {
      date: { start: lead.connectedAt.slice(0, 10) },
    }
  }
  if (lead.dm1SentAt) {
    properties['DM1 Sent At'] = {
      date: { start: lead.dm1SentAt.slice(0, 10) },
    }
  }
  if (lead.dm2SentAt) {
    properties['DM2 Sent At'] = {
      date: { start: lead.dm2SentAt.slice(0, 10) },
    }
  }
  if (lead.repliedAt) {
    properties['Replied At'] = {
      date: { start: lead.repliedAt.slice(0, 10) },
    }
  }

  await notionService.updatePage(lead.notionPageId, properties)
}

// ─── Push: Campaign metrics → Notion ─────────────────────────────────────────

export async function syncCampaignMetricsToNotion(config: GTMOSConfig): Promise<void> {
  // BUG-020: scope to current tenant; previously leaked across tenants.
  const tenantId = resolveTenant()
  const allCampaigns = await db.select().from(campaigns).where(eq(campaigns.tenantId, tenantId))

  for (const campaign of allCampaigns) {
    if (!campaign.notionPageId) continue

    const leads = await db.select().from(campaignLeads)
      .where(eq(campaignLeads.campaignId, campaign.id))

    const metrics = {
      totalLeads: leads.length,
      connectsSent: leads.filter(l => l.connectSentAt).length,
      connected: leads.filter(l => l.connectedAt).length,
      dm1Sent: leads.filter(l => l.dm1SentAt).length,
      dm2Sent: leads.filter(l => l.dm2SentAt).length,
      replied: leads.filter(l => l.repliedAt).length,
    }

    const acceptRate = metrics.connectsSent > 0
      ? (metrics.connected / metrics.connectsSent * 100).toFixed(1)
      : '0.0'
    const replyRate = metrics.dm1Sent > 0
      ? (metrics.replied / metrics.dm1Sent * 100).toFixed(1)
      : '0.0'

    const properties: Record<string, unknown> = {
      'Total Leads': { number: metrics.totalLeads },
      'Connects Sent': { number: metrics.connectsSent },
      'Connected': { number: metrics.connected },
      'Accept Rate': { rich_text: [{ text: { content: `${acceptRate}%` } }] },
      'DMs Sent': { number: metrics.dm1Sent + metrics.dm2Sent },
      'Replies': { number: metrics.replied },
      'Reply Rate': { rich_text: [{ text: { content: `${replyRate}%` } }] },
    }

    if (campaign.experimentStatus) {
      properties['Experiment Status'] = { select: { name: campaign.experimentStatus } }
    }
    if (campaign.winnerVariant) {
      properties['Winner Variant'] = { rich_text: [{ text: { content: campaign.winnerVariant } }] }
    }

    await notionService.updatePage(campaign.notionPageId, properties)
  }
}

// ─── Push: Variant stats → Notion ────────────────────────────────────────────

export async function syncVariantStatsToNotion(config: GTMOSConfig): Promise<void> {
  // BUG-020: scope to current tenant.
  const tenantId = resolveTenant()
  const allVariants = await db.select().from(campaignVariants).where(eq(campaignVariants.tenantId, tenantId))

  for (const variant of allVariants) {
    if (!variant.notionPageId) continue

    const properties: Record<string, unknown> = {
      'Status': { select: { name: variant.status } },
      'Sends': { number: variant.sends },
      'Accepts': { number: variant.accepts },
      'Accept Rate': { number: variant.acceptRate },
      'DMs Sent': { number: variant.dmsSent },
      'Replies': { number: variant.replies },
      'Reply Rate': { number: variant.replyRate },
    }

    await notionService.updatePage(variant.notionPageId, properties)
  }
}

// ─── Bulk Push ───────────────────────────────────────────────────────────────

async function pushLeadsToNotion(config: GTMOSConfig): Promise<void> {
  // BUG-020: scope to current tenant.
  const tenantId = resolveTenant()
  const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.tenantId, tenantId))
  let updated = 0

  for (const lead of leads) {
    if (!lead.notionPageId) continue
    await syncLeadToNotion(lead, config)
    updated++
  }

  console.log(`[sync] Pushed ${updated} lead updates to Notion`)
}

// ─── Pull: Notion edits → SQLite ─────────────────────────────────────────────

async function pullNotionEdits(config: GTMOSConfig): Promise<void> {
  // Pull manual status changes from Notion (e.g., user moves lead to Demo_Booked)
  const leadsDbId = config.notion.leads_ds
  if (!leadsDbId) {
    console.log('[sync] No leads_ds configured, skipping pull')
    return
  }

  const leads = await db.select().from(campaignLeads)
  const leadsWithNotion = leads.filter(l => l.notionPageId)

  if (leadsWithNotion.length === 0) {
    console.log('[sync] No leads with Notion page IDs, skipping pull')
    return
  }

  // Query Notion for pages that may have been manually updated
  // We check lifecycle status for manual changes (e.g., Demo_Booked, Deal_Created)
  const notionPages = await notionService.queryDatabase(leadsDbId)
  let pulled = 0

  for (const page of notionPages) {
    const props = (page as { id: string; properties?: Record<string, unknown> })?.properties
    if (!props) continue

    const pageId = (page as { id: string }).id
    const lead = leadsWithNotion.find(l => l.notionPageId === pageId)
    if (!lead) continue

    // Extract lifecycle status from Notion
    const statusProp = props['Lifecycle Status'] as { select?: { name?: string } } | undefined
    const notionStatus = statusProp?.select?.name
    if (!notionStatus || notionStatus === lead.lifecycleStatus) continue

    // Only pull statuses that indicate manual user action
    const manualStatuses = ['Demo_Booked', 'Deal_Created', 'Closed_Won', 'Closed_Lost']
    if (manualStatuses.includes(notionStatus)) {
      console.log(`[sync] ← ${lead.firstName} ${lead.lastName}: ${lead.lifecycleStatus} → ${notionStatus}`)
      await db.update(campaignLeads).set({
        lifecycleStatus: notionStatus,
        updatedAt: new Date().toISOString(),
      }).where(eq(campaignLeads.id, lead.id))
      pulled++

      // Wire conversion events to intelligence
      if (notionStatus === 'Demo_Booked' || notionStatus === 'Closed_Won') {
        try {
          const store = new IntelligenceStore()
          await store.add({
            category: 'icp',
            insight: `Lead with profile [${lead.headline ?? 'unknown'}, ${lead.company ?? 'unknown'}] converted to ${notionStatus}`,
            evidence: [{
              type: 'campaign_outcome',
              sourceId: lead.campaignId,
              metric: notionStatus.toLowerCase(),
              value: 1,
              sampleSize: 1,
              timestamp: new Date().toISOString(),
            }],
            segment: null,
            channel: 'linkedin',
            confidence: 'validated',
            source: 'campaign_outcome',
            biasCheck: null,
            supersedes: null,
            validatedAt: new Date().toISOString(),
            expiresAt: null,
          })
        } catch { /* intelligence is best-effort */ }
      }
    }
  }

  console.log(`[sync] Pulled ${pulled} manual updates from Notion`)
}
