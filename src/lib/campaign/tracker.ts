import { eq } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants } from '../db/schema'
import { unipileService } from '../services/unipile'
import { syncCampaignMetricsToNotion, syncVariantStatsToNotion } from '../notion/sync'
import { IntelligenceStore } from '../intelligence/store'
import { shouldPromote as checkShouldPromote } from '../intelligence/confidence'
import { validateMessage } from '../outbound/validator'
import type { GTMOSConfig } from '../config/types'

interface TrackerOptions {
  config: GTMOSConfig
  dryRun: boolean
  campaignId?: string
}

interface TrackerSummary {
  campaignsProcessed: number
  connectionsAccepted: number
  repliesDetected: number
  dm1sSent: number
  dm2sSent: number
  connectionsSent: number
  leadsExpired: number
}

export async function runTracker(opts: TrackerOptions): Promise<TrackerSummary> {
  const summary: TrackerSummary = {
    campaignsProcessed: 0,
    connectionsAccepted: 0,
    repliesDetected: 0,
    dm1sSent: 0,
    dm2sSent: 0,
    connectionsSent: 0,
    leadsExpired: 0,
  }

  console.log(`[tracker] Starting campaign tracker${opts.dryRun ? ' (DRY RUN)' : ''}`)

  // Phase 1: Load active campaigns
  const activeCampaigns = opts.campaignId
    ? await db.select().from(campaigns).where(eq(campaigns.id, opts.campaignId))
    : await db.select().from(campaigns).where(eq(campaigns.status, 'active'))

  if (activeCampaigns.length === 0) {
    console.log('[tracker] No active campaigns found.')
    return summary
  }

  console.log(`[tracker] Found ${activeCampaigns.length} active campaign(s)`)

  for (const campaign of activeCampaigns) {
    console.log(`\n[tracker] Processing: ${campaign.title}`)
    summary.campaignsProcessed++

    const accountId = campaign.linkedinAccountId
    if (!accountId) {
      console.log(`[tracker] ⚠ Campaign ${campaign.title} has no LinkedIn account ID, skipping`)
      continue
    }

    // Load leads + variants for this campaign
    const leads = await db.select().from(campaignLeads)
      .where(eq(campaignLeads.campaignId, campaign.id))
    const variants = await db.select().from(campaignVariants)
      .where(eq(campaignVariants.campaignId, campaign.id))

    const variantMap = new Map(variants.map(v => [v.id, v]))

    // Phase 2: Check acceptances
    const connectSentLeads = leads.filter(l => l.lifecycleStatus === 'Connect_Sent')
    if (connectSentLeads.length > 0) {
      console.log(`[tracker] Checking ${connectSentLeads.length} pending connections...`)
      const accepted = await checkAcceptances(accountId, connectSentLeads, opts.dryRun)
      summary.connectionsAccepted += accepted
    }

    // Phase 3: Check replies
    const dmSentLeads = leads.filter(l =>
      l.lifecycleStatus === 'DM1_Sent' || l.lifecycleStatus === 'DM2_Sent'
    )
    if (dmSentLeads.length > 0) {
      console.log(`[tracker] Checking ${dmSentLeads.length} leads for replies...`)
      const replied = await checkReplies(accountId, dmSentLeads, opts.dryRun)
      summary.repliesDetected += replied

      // Wire replies to intelligence
      if (!opts.dryRun && replied > 0) {
        const store = new IntelligenceStore()
        for (const lead of dmSentLeads) {
          if (lead.repliedAt) continue // already tracked
          const variant = lead.variantId ? variantMap.get(lead.variantId) : null
          if (!variant) continue
          try {
            await store.add({
              category: 'campaign',
              insight: `Variant "${variant.name}" messaging generated a reply from ${lead.headline ?? 'unknown role'} at ${lead.company ?? 'unknown company'}`,
              evidence: [{
                type: 'campaign_outcome',
                sourceId: campaign.id,
                metric: 'reply',
                value: 1,
                sampleSize: variant.dmsSent ?? 0,
                timestamp: new Date().toISOString(),
              }],
              segment: null,
              channel: 'linkedin',
              confidence: 'hypothesis',
              source: 'campaign_outcome',
              biasCheck: null,
              supersedes: null,
              validatedAt: null,
              expiresAt: null,
            })
          } catch { /* intelligence is best-effort */ }
        }
      }
    }

    // Phase 4: Advance sequences
    const timing = typeof campaign.sequenceTiming === 'string'
      ? JSON.parse(campaign.sequenceTiming)
      : campaign.sequenceTiming ?? { connect_to_dm1_days: 2, dm1_to_dm2_days: 3 }

    const connectedLeads = leads.filter(l => l.lifecycleStatus === 'Connected')
    for (const lead of connectedLeads) {
      if (isDaysAgo(lead.connectedAt, timing.connect_to_dm1_days)) {
        const variant = lead.variantId ? variantMap.get(lead.variantId) : null
        const template = variant?.dm1Template ?? ''
        if (!template) continue

        const message = personalize(template, lead)
        console.log(`[tracker] → DM1 to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

        if (!opts.dryRun) {
          await unipileService.sendMessage(accountId, lead.providerId, message)
          await db.update(campaignLeads).set({
            lifecycleStatus: 'DM1_Sent',
            dm1SentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(campaignLeads.id, lead.id))

          if (variant) {
            await db.update(campaignVariants).set({
              dmsSent: (variant.dmsSent ?? 0) + 1,
            }).where(eq(campaignVariants.id, variant.id))
          }

          await delay(opts.config.unipile.rate_limit_ms)
        }
        summary.dm1sSent++
      }
    }

    const dm1SentLeads = leads.filter(l => l.lifecycleStatus === 'DM1_Sent')
    for (const lead of dm1SentLeads) {
      if (isDaysAgo(lead.dm1SentAt, timing.dm1_to_dm2_days)) {
        const variant = lead.variantId ? variantMap.get(lead.variantId) : null
        const template = variant?.dm2Template ?? ''
        if (!template) continue

        const message = personalize(template, lead)
        console.log(`[tracker] → DM2 to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

        if (!opts.dryRun) {
          await unipileService.sendMessage(accountId, lead.providerId, message)
          await db.update(campaignLeads).set({
            lifecycleStatus: 'DM2_Sent',
            dm2SentAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(campaignLeads.id, lead.id))

          if (variant) {
            await db.update(campaignVariants).set({
              dmsSent: (variant.dmsSent ?? 0) + 1,
            }).where(eq(campaignVariants.id, variant.id))
          }

          await delay(opts.config.unipile.rate_limit_ms)
        }
        summary.dm2sSent++
      }
    }

    // Phase 5: Send queued connections
    const dailyLimit = campaign.dailyLimit ?? opts.config.unipile.daily_connect_limit
    const todaysSends = leads.filter(l =>
      l.connectSentAt && isToday(l.connectSentAt)
    ).length

    const budget = Math.max(0, dailyLimit - todaysSends)
    const queuedLeads = leads.filter(l => l.lifecycleStatus === 'Queued').slice(0, budget)

    if (queuedLeads.length > 0) {
      console.log(`[tracker] Sending ${queuedLeads.length} connections (budget: ${budget}/${dailyLimit})...`)
    }

    for (const lead of queuedLeads) {
      const variant = lead.variantId ? variantMap.get(lead.variantId) : null
      const note = variant?.connectNote
        ? personalize(variant.connectNote, lead)
        : undefined

      console.log(`[tracker] → Connect to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

      if (!opts.dryRun) {
        await unipileService.sendConnection(accountId, lead.providerId, note)
        await db.update(campaignLeads).set({
          lifecycleStatus: 'Connect_Sent',
          connectSentAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }).where(eq(campaignLeads.id, lead.id))

        if (variant) {
          await db.update(campaignVariants).set({
            sends: (variant.sends ?? 0) + 1,
          }).where(eq(campaignVariants.id, variant.id))
        }

        await delay(opts.config.unipile.rate_limit_ms)
      }
      summary.connectionsSent++
    }

    // Phase 6: Auto-complete stale leads
    const staleConnects = leads.filter(l =>
      l.lifecycleStatus === 'Connect_Sent' && isDaysAgo(l.connectSentAt, 30)
    )
    const staleNoReply = leads.filter(l =>
      l.lifecycleStatus === 'DM2_Sent' && isDaysAgo(l.dm2SentAt, 14)
    )

    for (const lead of [...staleConnects, ...staleNoReply]) {
      const status = lead.lifecycleStatus === 'Connect_Sent' ? 'Expired' : 'No_Reply'
      console.log(`[tracker] ⏳ ${lead.firstName} ${lead.lastName} → ${status}`)

      if (!opts.dryRun) {
        await db.update(campaignLeads).set({
          lifecycleStatus: status,
          updatedAt: new Date().toISOString(),
        }).where(eq(campaignLeads.id, lead.id))
      }
      summary.leadsExpired++
    }

    // Phase 7: Recalculate variant metrics
    if (!opts.dryRun) {
      for (const variant of variants) {
        const variantLeads = leads.filter(l => l.variantId === variant.id)
        const sends = variantLeads.filter(l => l.connectSentAt).length
        const accepts = variantLeads.filter(l => l.connectedAt).length
        const dms = variantLeads.filter(l => l.dm1SentAt).length
        const replies = variantLeads.filter(l => l.repliedAt).length

        await db.update(campaignVariants).set({
          sends,
          accepts,
          acceptRate: sends > 0 ? accepts / sends : 0,
          dmsSent: dms,
          replies,
          replyRate: dms > 0 ? replies / dms : 0,
        }).where(eq(campaignVariants.id, variant.id))
      }
    }

    // Phase 7a: Check intelligence promotions
    if (!opts.dryRun) {
      try {
        const store = new IntelligenceStore()
        const allIntelligence = await store.query({ source: 'campaign_outcome' })
        for (const entry of allIntelligence) {
          const { shouldPromote } = checkShouldPromote(entry)
          if (shouldPromote) {
            try { await store.promote(entry.id) } catch { /* already at max */ }
          }
        }
      } catch { /* intelligence is best-effort */ }
    }

    // Phase 7b: Sync to Notion
    if (!opts.dryRun) {
      console.log(`[tracker] Syncing to Notion...`)
      await syncCampaignMetricsToNotion(opts.config)
      await syncVariantStatsToNotion(opts.config)
    }
  }

  // Phase 8: Log summary
  console.log('\n─── Tracker Summary ───')
  console.log(`Campaigns processed:    ${summary.campaignsProcessed}`)
  console.log(`Connections accepted:    ${summary.connectionsAccepted}`)
  console.log(`Replies detected:       ${summary.repliesDetected}`)
  console.log(`DM1s sent:              ${summary.dm1sSent}`)
  console.log(`DM2s sent:              ${summary.dm2sSent}`)
  console.log(`Connections sent:       ${summary.connectionsSent}`)
  console.log(`Leads expired:          ${summary.leadsExpired}`)

  return summary
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkAcceptances(
  accountId: string,
  leads: typeof campaignLeads.$inferSelect[],
  dryRun: boolean
): Promise<number> {
  let count = 0
  try {
    const relations = await unipileService.listRelations(accountId, 500)
    const connectedIds = new Set<string>()

    // Extract provider IDs from relations
    const items = (relations as { items?: { provider_id?: string }[] })?.items ?? []
    for (const rel of items) {
      if (rel.provider_id) connectedIds.add(rel.provider_id)
    }

    for (const lead of leads) {
      if (connectedIds.has(lead.providerId)) {
        console.log(`[tracker] ✓ ${lead.firstName} ${lead.lastName} accepted connection`)
        if (!dryRun) {
          await db.update(campaignLeads).set({
            lifecycleStatus: 'Connected',
            connectedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(campaignLeads.id, lead.id))
        }
        count++
      }
    }
  } catch (err) {
    console.error('[tracker] Error checking acceptances:', err)
  }
  return count
}

async function checkReplies(
  accountId: string,
  leads: typeof campaignLeads.$inferSelect[],
  dryRun: boolean
): Promise<number> {
  let count = 0
  try {
    const chats = await unipileService.listChats(accountId)
    const chatItems = (chats as { items?: { attendees?: { provider_id?: string }[], messages?: { sender_id?: string, text?: string }[] }[] })?.items ?? []

    // Build a map: providerId → has reply from them
    const repliedProviderIds = new Set<string>()
    for (const chat of chatItems) {
      const attendeeIds = chat.attendees?.map(a => a.provider_id).filter(Boolean) ?? []
      const hasReply = chat.messages?.some(m =>
        attendeeIds.includes(m.sender_id) && m.sender_id !== accountId
      ) ?? false
      if (hasReply) {
        for (const id of attendeeIds) {
          if (id) repliedProviderIds.add(id)
        }
      }
    }

    for (const lead of leads) {
      if (repliedProviderIds.has(lead.providerId) && !lead.repliedAt) {
        console.log(`[tracker] 💬 ${lead.firstName} ${lead.lastName} replied!`)
        if (!dryRun) {
          await db.update(campaignLeads).set({
            lifecycleStatus: 'Replied',
            repliedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }).where(eq(campaignLeads.id, lead.id))
        }
        count++
      }
    }
  } catch (err) {
    console.error('[tracker] Error checking replies:', err)
  }
  return count
}

function personalize(template: string, lead: typeof campaignLeads.$inferSelect): string {
  const text = template
    .replace(/\{\{first_name\}\}/g, lead.firstName ?? '')
    .replace(/\{\{last_name\}\}/g, lead.lastName ?? '')
    .replace(/\{\{company\}\}/g, lead.company ?? '')
    .replace(/\{\{headline\}\}/g, lead.headline ?? '')

  // Block sending of non-compliant messages
  const result = validateMessage(text)
  const hardViolations = result.violations.filter(v => v.severity === 'hard')
  if (hardViolations.length > 0) {
    console.log(`[tracker] BLOCKED message for ${lead.firstName} ${lead.lastName}: ${hardViolations.map(v => v.ruleName).join(', ')}`)
    return ''
  }

  return text
}

function isDaysAgo(dateStr: string | null, days: number): boolean {
  if (!dateStr) return false
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  return diffMs >= days * 24 * 60 * 60 * 1000
}

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr)
  const now = new Date()
  return date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
