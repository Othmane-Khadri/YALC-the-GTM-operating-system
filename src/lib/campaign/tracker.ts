import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants } from '../db/schema'
import { unipileService } from '../services/unipile'
import { syncCampaignMetricsToNotion, syncVariantStatsToNotion } from '../notion/sync'
import { IntelligenceStore } from '../intelligence/store'
import { shouldPromote as checkShouldPromote } from '../intelligence/confidence'
import { validateMessage } from '../outbound/validator'
import { rateLimiter } from '../rate-limiter'
import { instantlyService } from '../services/instantly'
import { fullenrichService } from '../services/fullenrich'
import { calculateSignificance } from './significance'
import type { GTMOSConfig } from '../config/types'
import { fireWebhooks } from '../services/webhooks'
import { sendSlackNotification, setSlackConfig } from '../services/slack'
import { parseSchedule, shouldAutoActivate, isWithinSendWindow, isBusinessDaysAgo } from './schedule'
import { DEFAULT_TENANT } from '../tenant/index.js'
import { hasReplied } from './blocklist.js'
import { signalsLog } from '../db/schema'
import { randomUUID } from 'crypto'

/**
 * Log a "send skipped because the prospect already replied" event. Best-effort.
 */
async function logSendSkippedAlreadyReplied(
  tenantId: string,
  campaignId: string,
  leadId: string,
  channel: 'linkedin.connect' | 'linkedin.dm' | 'email',
): Promise<void> {
  try {
    await db.insert(signalsLog).values({
      id: randomUUID(),
      tenantId,
      type: 'send.skipped.already_replied',
      category: 'outbound',
      data: JSON.stringify({ channel, leadId, campaignId }),
      campaignId,
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[tracker] signals_log write failed (best-effort):', err)
  }
}

interface TrackerOptions {
  config: GTMOSConfig
  dryRun: boolean
  campaignId?: string
  tenantId?: string
}

interface TrackerSummary {
  campaignsProcessed: number
  campaignsActivated: number
  campaignsSkipped: number
  connectionsAccepted: number
  repliesDetected: number
  dm1sSent: number
  dm2sSent: number
  connectionsSent: number
  leadsExpired: number
  emailsTracked: number
  emailsEnriched: number
  emailsQueued: number
}

export async function runTracker(opts: TrackerOptions): Promise<TrackerSummary> {
  const tenantId = opts.tenantId ?? DEFAULT_TENANT
  const campaignScope = () => eq(campaigns.tenantId, tenantId)
  const leadScope = () => eq(campaignLeads.tenantId, tenantId)
  const variantScope = () => eq(campaignVariants.tenantId, tenantId)
  const summary: TrackerSummary = {
    campaignsProcessed: 0,
    campaignsActivated: 0,
    campaignsSkipped: 0,
    connectionsAccepted: 0,
    repliesDetected: 0,
    dm1sSent: 0,
    dm2sSent: 0,
    connectionsSent: 0,
    leadsExpired: 0,
    emailsTracked: 0,
    emailsEnriched: 0,
    emailsQueued: 0,
  }

  console.log(`[tracker] Starting campaign tracker${opts.dryRun ? ' (DRY RUN)' : ''}`)

  // Initialize Slack config if available
  setSlackConfig(opts.config.slack)

  // ── Gate A: Auto-activate scheduled campaigns ──────────────────────────────
  if (!opts.campaignId) {
    const scheduledCampaigns = await db
      .select()
      .from(campaigns)
      .where(and(campaignScope(), eq(campaigns.status, 'scheduled')))
    for (const camp of scheduledCampaigns) {
      const schedule = parseSchedule(camp.schedule)
      if (schedule && shouldAutoActivate(schedule)) {
        console.log(`[tracker] Auto-activating scheduled campaign: ${camp.title} (startAt: ${schedule.startAt})`)
        if (!opts.dryRun) {
          await db.update(campaigns).set({
            status: 'active',
            updatedAt: new Date().toISOString(),
          }).where(and(campaignScope(), eq(campaigns.id, camp.id)))
        }
        summary.campaignsActivated++
      }
    }
  }

  // Phase 1: Load active campaigns
  const activeCampaigns = opts.campaignId
    ? await db
        .select()
        .from(campaigns)
        .where(and(campaignScope(), eq(campaigns.id, opts.campaignId)))
    : await db
        .select()
        .from(campaigns)
        .where(and(campaignScope(), eq(campaigns.status, 'active')))

  if (activeCampaigns.length === 0) {
    console.log('[tracker] No active campaigns found.')
    return summary
  }

  console.log(`[tracker] Found ${activeCampaigns.length} active campaign(s)`)

  for (const campaign of activeCampaigns) {
    const schedule = parseSchedule(campaign.schedule)

    // ── Gate B: Send window check ──────────────────────────────────────────
    if (schedule) {
      if (schedule.activeDays.length === 0) {
        console.log(`[tracker] Campaign "${campaign.title}" has no active days — skipping`)
        summary.campaignsSkipped++
        continue
      }
      const windowCheck = isWithinSendWindow(schedule)
      if (!windowCheck.allowed) {
        console.log(`[tracker] Campaign "${campaign.title}" outside send window (${windowCheck.reason}) — skipping`)
        summary.campaignsSkipped++
        continue
      }
    }

    console.log(`\n[tracker] Processing: ${campaign.title}`)
    summary.campaignsProcessed++

    // ── Gate C helper: per-campaign send pace ────────────────────────────────
    const paceDelayMs = schedule
      ? schedule.sendingPace.secondsBetweenSends * 1000
      : opts.config.unipile.rate_limit_ms

    const accountId = campaign.linkedinAccountId
    if (!accountId) {
      console.log(`[tracker] ⚠ Campaign ${campaign.title} has no LinkedIn account ID, skipping`)
      continue
    }

    // Load leads + variants for this campaign
    const leads = await db.select().from(campaignLeads)
      .where(and(leadScope(), eq(campaignLeads.campaignId, campaign.id)))
    const variants = await db.select().from(campaignVariants)
      .where(and(variantScope(), eq(campaignVariants.campaignId, campaign.id)))

    const variantMap = new Map(variants.map(v => [v.id, v]))

    // ── Phase 1.5a: FullEnrich pre-flight (email enrichment) ───────────────
    if (!opts.dryRun && fullenrichService.isAvailable()) {
      const needEmail = leads.filter(l => !l.email && (l.firstName || l.lastName))
      if (needEmail.length > 0) {
        console.log(`[tracker] Enriching ${needEmail.length} leads with FullEnrich...`)
        try {
          const enrichmentId = await fullenrichService.enrichBulk(needEmail.map(l => ({
            firstname: l.firstName ?? '',
            lastname: l.lastName ?? '',
            company_name: l.company ?? undefined,
            linkedin_url: l.linkedinUrl ?? undefined,
          })))
          const results = await fullenrichService.pollResults(enrichmentId)
          // Build lookup keys (name + linkedin) — DO NOT trust index alignment.
          // FullEnrich returns results in arbitrary order with possible drops.
          const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
          const byName = new Map<string, typeof results[number]>()
          const byLinkedin = new Map<string, typeof results[number]>()
          for (const r of results) {
            const nameKey = `${norm(r.firstname)}|${norm(r.lastname)}`
            if (nameKey !== '|' && !byName.has(nameKey)) byName.set(nameKey, r)
            if (r.linkedin_url) {
              const lk = norm(r.linkedin_url)
              if (lk && !byLinkedin.has(lk)) byLinkedin.set(lk, r)
            }
          }
          for (const lead of needEmail) {
            // Match by linkedin URL first (most reliable), then by name.
            let result: typeof results[number] | undefined
            if (lead.linkedinUrl) result = byLinkedin.get(norm(lead.linkedinUrl))
            if (!result) result = byName.get(`${norm(lead.firstName)}|${norm(lead.lastName)}`)
            if (!result) continue
            if (result.email) {
              await db.update(campaignLeads).set({
                email: result.email,
                emailStatus: result.email_status ?? 'unverified',
                updatedAt: new Date().toISOString(),
              }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))
              // Mutate in-memory copy so downstream phases see it
              lead.email = result.email
              lead.emailStatus = result.email_status ?? 'unverified'
              summary.emailsEnriched++
            }
          }
        } catch (err) {
          console.error('[tracker] FullEnrich enrichment failed:', err)
        }
      }
    }

    // ── Phase 1.5b: Instantly campaign creation + lead push ────────────────
    const channelsList = parseChannels(campaign.channels)
    if (!opts.dryRun && channelsList.includes('email') && instantlyService.isAvailable()) {
      // One Instantly campaign per (gtm campaign, variant). Group eligible leads by variant.
      const eligible = leads.filter(l =>
        l.email
        && (l.emailStatus === 'valid' || l.emailStatus === 'unverified' || !l.emailStatus)
        && !l.instantlyCampaignId
      )

      if (eligible.length > 0) {
        // Find existing instantly campaign IDs already stamped on leads in this campaign, per variant
        const existingByVariant = new Map<string, string>()
        for (const l of leads) {
          if (l.variantId && l.instantlyCampaignId && !existingByVariant.has(l.variantId)) {
            existingByVariant.set(l.variantId, l.instantlyCampaignId)
          }
        }

        const eligibleByVariant = new Map<string, typeof eligible>()
        for (const l of eligible) {
          const key = l.variantId ?? '__default__'
          if (!eligibleByVariant.has(key)) eligibleByVariant.set(key, [])
          eligibleByVariant.get(key)!.push(l)
        }

        for (const [variantKey, variantLeads] of eligibleByVariant) {
          const variant = variantKey === '__default__' ? null : variantMap.get(variantKey)

          // Validate body templates before creating the Instantly campaign
          const subject = variant ? `${variant.name}` : campaign.title
          const body1 = variant?.dm1Template ?? ''
          const body2 = variant?.dm2Template ?? ''
          if (!body1) {
            console.log(`[tracker] Skipping Instantly send for variant "${variant?.name ?? 'default'}" — no template`)
            continue
          }
          const v1 = validateMessage(body1)
          if (v1.violations.some(v => v.severity === 'hard')) {
            console.log(`[tracker] BLOCKED Instantly create for "${variant?.name ?? 'default'}" (body1): ${v1.violations.map(v => v.ruleName).join(', ')}`)
            continue
          }
          if (body2) {
            const v2 = validateMessage(body2)
            if (v2.violations.some(v => v.severity === 'hard')) {
              console.log(`[tracker] BLOCKED Instantly create for "${variant?.name ?? 'default'}" (body2): ${v2.violations.map(v => v.ruleName).join(', ')}`)
              continue
            }
          }

          let instantlyCampaignId = existingByVariant.get(variantKey)

          try {
            if (!instantlyCampaignId) {
              const created = await instantlyService.createCampaign({
                name: `${campaign.title} — ${variant?.name ?? 'default'}`,
                sequences: [
                  { subject, body: body1, delay_days: 0 },
                  ...(body2 ? [{ subject: `Re: ${subject}`, body: body2, delay_days: 3 }] : []),
                ],
                schedule: scheduleToInstantly(schedule),
              })
              instantlyCampaignId = created.id
              console.log(`[tracker] Created Instantly campaign ${instantlyCampaignId} for "${variant?.name ?? 'default'}"`)
            }

            // Pre-send blocklist filter (P2.2): drop leads who already replied.
            const sendable: typeof variantLeads = []
            for (const l of variantLeads) {
              if (
                await hasReplied(
                  tenantId,
                  { providerId: l.providerId, linkedinUrl: l.linkedinUrl, email: l.email },
                  { campaignId: campaign.id },
                )
              ) {
                console.log(`[tracker] ⏭  Email SKIPPED for ${l.firstName} ${l.lastName} — already replied / blocklisted`)
                await logSendSkippedAlreadyReplied(tenantId, campaign.id, l.id, 'email')
                continue
              }
              sendable.push(l)
            }

            // Acquire rate limit budget for the batch
            let allowed = 0
            for (let i = 0; i < sendable.length; i++) {
              if (await rateLimiter.acquire('instantly.send', instantlyCampaignId ?? `gtm:${campaign.id}`)) {
                allowed++
              } else {
                console.log(`[tracker] Instantly rate limit hit. ${allowed}/${sendable.length} leads queued.`)
                break
              }
            }
            const toPush = sendable.slice(0, allowed)
            if (toPush.length === 0) continue

            await instantlyService.addLeadsToCampaign(instantlyCampaignId, toPush.map(l => ({
              email: l.email!,
              first_name: l.firstName ?? undefined,
              last_name: l.lastName ?? undefined,
              company_name: l.company ?? undefined,
            })))

            const nowIso = new Date().toISOString()
            for (const l of toPush) {
              await db.update(campaignLeads).set({
                instantlyCampaignId,
                emailStatus: 'sent',
                emailSentAt: nowIso,
                updatedAt: nowIso,
              }).where(and(leadScope(), eq(campaignLeads.id, l.id)))
              l.instantlyCampaignId = instantlyCampaignId
              l.emailStatus = 'sent'
              l.emailSentAt = nowIso
              summary.emailsQueued++
            }
          } catch (err) {
            console.error(`[tracker] Failed Instantly send for variant "${variant?.name ?? 'default'}":`, err)
          }
        }
      }
    }

    // Phase 2: Check acceptances
    const connectSentLeads = leads.filter(l => l.lifecycleStatus === 'Connect_Sent')
    if (connectSentLeads.length > 0) {
      console.log(`[tracker] Checking ${connectSentLeads.length} pending connections...`)
      const accepted = await checkAcceptances(tenantId, accountId, connectSentLeads, opts.dryRun)
      summary.connectionsAccepted += accepted
    }

    // Phase 3: Check replies
    const dmSentLeads = leads.filter(l =>
      l.lifecycleStatus === 'DM1_Sent' || l.lifecycleStatus === 'DM2_Sent'
    )
    if (dmSentLeads.length > 0) {
      console.log(`[tracker] Checking ${dmSentLeads.length} leads for replies...`)
      const { count: replied, repliedLeadIds } = await checkReplies(tenantId, accountId, dmSentLeads, opts.dryRun)
      summary.repliesDetected += replied

      // Fire webhooks + Slack only for leads that ACTUALLY newly replied
      if (!opts.dryRun && replied > 0) {
        for (const lead of dmSentLeads) {
          if (!repliedLeadIds.has(lead.id)) continue
          fireWebhooks('reply.received', { campaignId: campaign.id, leadId: lead.id })
          sendSlackNotification('reply', {
            campaignId: campaign.id,
            campaignTitle: campaign.title,
            leadName: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
            leadId: lead.id,
          })
        }
      }

      // Wire replies to intelligence — only for newly replied leads
      if (!opts.dryRun && replied > 0) {
        const store = new IntelligenceStore(tenantId)
        for (const lead of dmSentLeads) {
          if (!repliedLeadIds.has(lead.id)) continue
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
          } catch (err) { console.error('[tracker] intelligence store add failed (best-effort):', err) }
        }
      }
    }

    // Phase 4: Advance sequences
    const defaultTiming = { connect_to_dm1_days: 2, dm1_to_dm2_days: 3 }
    let timing: { connect_to_dm1_days: number; dm1_to_dm2_days: number } = defaultTiming
    if (campaign.sequenceTiming) {
      if (typeof campaign.sequenceTiming === 'string') {
        try {
          const parsed = JSON.parse(campaign.sequenceTiming)
          if (parsed && typeof parsed === 'object') timing = { ...defaultTiming, ...parsed }
        } catch (err) {
          console.error(`[tracker] Invalid sequenceTiming JSON for campaign ${campaign.id}; using defaults:`, err)
        }
      } else {
        timing = { ...defaultTiming, ...(campaign.sequenceTiming as object) }
      }
    }

    const connectedLeads = leads.filter(l => l.lifecycleStatus === 'Connected')
    for (const lead of connectedLeads) {
      if (isBusinessDaysAgo(lead.connectedAt, timing.connect_to_dm1_days, schedule)) {
        // Pre-send blocklist check (P2.2): skip if this prospect already
        // replied in any campaign, or is on the permanent/campaign blocklist.
        if (
          await hasReplied(
            tenantId,
            { providerId: lead.providerId, linkedinUrl: lead.linkedinUrl, email: lead.email },
            { campaignId: campaign.id },
          )
        ) {
          console.log(`[tracker] ⏭  DM1 SKIPPED for ${lead.firstName} ${lead.lastName} — already replied / blocklisted`)
          await logSendSkippedAlreadyReplied(tenantId, campaign.id, lead.id, 'linkedin.dm')
          continue
        }
        const variant = lead.variantId ? variantMap.get(lead.variantId) : null
        const template = variant?.dm1Template ?? ''
        if (!template) continue

        const message = personalize(template, lead)
        if (!message) continue
        console.log(`[tracker] → DM1 to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

        if (!opts.dryRun) {
          if (!await rateLimiter.acquire('linkedin.dm', accountId)) {
            const remaining = await rateLimiter.getRemaining('linkedin.dm', accountId)
            console.log(`[tracker] Rate limit hit for linkedin.dm. Remaining: ${remaining}/100. Skipping.`)
            break
          }
          try {
            // Mark pending BEFORE external call to prevent duplicate sends on retry
            await db.update(campaignLeads).set({
              lifecycleStatus: 'DM1_Pending',
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

            await unipileService.sendMessage(accountId, lead.providerId, message)

            await db.transaction(async (tx) => {
              await tx.update(campaignLeads).set({
                lifecycleStatus: 'DM1_Sent',
                dm1SentAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

              if (variant) {
                await tx.update(campaignVariants).set({
                  dmsSent: (variant.dmsSent ?? 0) + 1,
                }).where(and(variantScope(), eq(campaignVariants.id, variant.id)))
              }
            })
          } catch (err) {
            // Revert pending status on failure so lead can be retried
            await db.update(campaignLeads).set({
              lifecycleStatus: 'Connected',
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id))).catch(() => {})
            console.error(`[tracker] Failed DM1 for ${lead.firstName} ${lead.lastName}:`, err)
            continue
          }

          await delay(paceDelayMs)
        }
        summary.dm1sSent++
      }
    }

    const dm1SentLeads = leads.filter(l => l.lifecycleStatus === 'DM1_Sent')
    for (const lead of dm1SentLeads) {
      if (isBusinessDaysAgo(lead.dm1SentAt, timing.dm1_to_dm2_days, schedule)) {
        // Pre-send blocklist check (P2.2).
        if (
          await hasReplied(
            tenantId,
            { providerId: lead.providerId, linkedinUrl: lead.linkedinUrl, email: lead.email },
            { campaignId: campaign.id },
          )
        ) {
          console.log(`[tracker] ⏭  DM2 SKIPPED for ${lead.firstName} ${lead.lastName} — already replied / blocklisted`)
          await logSendSkippedAlreadyReplied(tenantId, campaign.id, lead.id, 'linkedin.dm')
          continue
        }
        const variant = lead.variantId ? variantMap.get(lead.variantId) : null
        const template = variant?.dm2Template ?? ''
        if (!template) continue

        const message = personalize(template, lead)
        if (!message) continue
        console.log(`[tracker] → DM2 to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

        if (!opts.dryRun) {
          if (!await rateLimiter.acquire('linkedin.dm', accountId)) {
            const remaining = await rateLimiter.getRemaining('linkedin.dm', accountId)
            console.log(`[tracker] Rate limit hit for linkedin.dm. Remaining: ${remaining}/100. Skipping.`)
            break
          }
          try {
            // Mark pending BEFORE external call to prevent duplicate sends on retry
            await db.update(campaignLeads).set({
              lifecycleStatus: 'DM2_Pending',
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

            await unipileService.sendMessage(accountId, lead.providerId, message)

            await db.transaction(async (tx) => {
              await tx.update(campaignLeads).set({
                lifecycleStatus: 'DM2_Sent',
                dm2SentAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

              if (variant) {
                await tx.update(campaignVariants).set({
                  dmsSent: (variant.dmsSent ?? 0) + 1,
                }).where(and(variantScope(), eq(campaignVariants.id, variant.id)))
              }
            })
          } catch (err) {
            // Revert pending status on failure so lead can be retried
            await db.update(campaignLeads).set({
              lifecycleStatus: 'DM1_Sent',
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id))).catch(() => {})
            console.error(`[tracker] Failed DM2 for ${lead.firstName} ${lead.lastName}:`, err)
            continue
          }

          await delay(paceDelayMs)
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
      // Pre-send blocklist check (P2.2).
      if (
        await hasReplied(
          tenantId,
          { providerId: lead.providerId, linkedinUrl: lead.linkedinUrl, email: lead.email },
          { campaignId: campaign.id },
        )
      ) {
        console.log(`[tracker] ⏭  Connect SKIPPED for ${lead.firstName} ${lead.lastName} — already replied / blocklisted`)
        await logSendSkippedAlreadyReplied(tenantId, campaign.id, lead.id, 'linkedin.connect')
        continue
      }

      const variant = lead.variantId ? variantMap.get(lead.variantId) : null
      const note = variant?.connectNote
        ? personalize(variant.connectNote, lead)
        : undefined

      console.log(`[tracker] → Connect to ${lead.firstName} ${lead.lastName} (${variant?.name ?? 'default'})`)

      if (!opts.dryRun) {
        if (!await rateLimiter.acquire('linkedin.connect', accountId)) {
          const remaining = await rateLimiter.getRemaining('linkedin.connect', accountId)
          console.log(`[tracker] Rate limit hit for linkedin.connect. Remaining: ${remaining}/30. Skipping.`)
          break
        }
        try {
          // Mark pending BEFORE external call to prevent duplicate sends on retry
          await db.update(campaignLeads).set({
            lifecycleStatus: 'Connect_Pending',
            updatedAt: new Date().toISOString(),
          }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

          await unipileService.sendConnection(accountId, lead.providerId, note)

          await db.transaction(async (tx) => {
            await tx.update(campaignLeads).set({
              lifecycleStatus: 'Connect_Sent',
              connectSentAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))

            if (variant) {
              await tx.update(campaignVariants).set({
                sends: (variant.sends ?? 0) + 1,
              }).where(and(variantScope(), eq(campaignVariants.id, variant.id)))
            }
          })
        } catch (err) {
          // Revert pending status on failure so lead can be retried
          await db.update(campaignLeads).set({
            lifecycleStatus: 'Queued',
            updatedAt: new Date().toISOString(),
          }).where(and(leadScope(), eq(campaignLeads.id, lead.id))).catch(() => {})
          console.error(`[tracker] Failed connect for ${lead.firstName} ${lead.lastName}:`, err)
          continue
        }

        await delay(paceDelayMs)
      }
      summary.connectionsSent++
    }

    // Phase 6: Auto-complete stale leads (always calendar days — staleness isn't business-sensitive)
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
        try {
          await db.transaction(async (tx) => {
            await tx.update(campaignLeads).set({
              lifecycleStatus: status,
              updatedAt: new Date().toISOString(),
            }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))
          })
        } catch (err) {
          console.error(`[tracker] Failed to expire ${lead.firstName} ${lead.lastName}:`, err)
          continue
        }
      }
      summary.leadsExpired++
    }

    // Phase 7: Recalculate variant metrics
    if (!opts.dryRun) {
      try {
        await db.transaction(async (tx) => {
          for (const variant of variants) {
            const variantLeads = leads.filter(l => l.variantId === variant.id)
            const sends = variantLeads.filter(l => l.connectSentAt).length
            const accepts = variantLeads.filter(l => l.connectedAt).length
            const dms = variantLeads.filter(l => l.dm1SentAt).length
            // BUG-014: only count LinkedIn DM replies in the LinkedIn variant stats.
            // Email replies are tracked separately and would otherwise inflate
            // the variant's reply rate against a LinkedIn-only denominator.
            const replies = variantLeads.filter(l => l.repliedAt && !l.emailRepliedAt).length

            await tx.update(campaignVariants).set({
              sends,
              accepts,
              acceptRate: sends > 0 ? accepts / sends : 0,
              dmsSent: dms,
              replies,
              replyRate: dms > 0 ? replies / dms : 0,
            }).where(and(variantScope(), eq(campaignVariants.id, variant.id)))
          }
        })
      } catch (err) {
        console.error('[tracker] Failed to recalculate variant metrics:', err)
      }

      // Phase 7 (cont.): A/B significance check — auto-pause losing variant
      if (variants.length >= 2) {
        const activeVariants = variants.filter(v => v.status === 'active')
        for (let i = 0; i < activeVariants.length; i++) {
          for (let j = i + 1; j < activeVariants.length; j++) {
            const vA = activeVariants[i]
            const vB = activeVariants[j]
            const result = calculateSignificance(
              { sends: vA.sends ?? 0, conversions: vA.replies ?? 0 },
              { sends: vB.sends ?? 0, conversions: vB.replies ?? 0 },
            )
            if (result.significant && result.winner) {
              const loser = result.winner === 'A' ? vB : vA
              const winner = result.winner === 'A' ? vA : vB
              console.log(`[tracker] A/B significant: "${winner.name}" beats "${loser.name}" (p=${result.pValue.toFixed(4)}, lift=${result.liftPercent.toFixed(1)}%). Retiring loser.`)
              await db.update(campaignVariants).set({ status: 'retired' }).where(and(variantScope(), eq(campaignVariants.id, loser.id)))
              await db.update(campaignVariants).set({ status: 'winner' }).where(and(variantScope(), eq(campaignVariants.id, winner.id)))
              await db.update(campaigns).set({
                experimentStatus: 'winner_declared',
                winnerVariant: winner.name,
              }).where(and(campaignScope(), eq(campaigns.id, campaign.id)))

              fireWebhooks('campaign.completed', { campaignId: campaign.id, winner: winner.name, pValue: result.pValue })
              sendSlackNotification('winner_declared', {
                campaignId: campaign.id,
                campaignTitle: campaign.title,
                leadName: `${winner.name} vs ${loser.name}`,
                leadId: winner.id,
              })
            }
          }
        }
      }
    }

    // Phase 7a: Check intelligence promotions
    if (!opts.dryRun) {
      try {
        const store = new IntelligenceStore(tenantId)
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

  // Phase 8: Email campaign tracking (Instantly)
  if (!opts.dryRun && instantlyService.isAvailable()) {
    // Find leads with Instantly campaign IDs
    for (const campaign of activeCampaigns) {
      const leads = await db.select().from(campaignLeads)
        .where(and(leadScope(), eq(campaignLeads.campaignId, campaign.id)))
      const emailLeads = leads.filter(l => l.instantlyCampaignId && l.email)

      if (emailLeads.length === 0) continue

      // Group by Instantly campaign ID
      const byCampaign = new Map<string, typeof emailLeads>()
      for (const lead of emailLeads) {
        const cid = lead.instantlyCampaignId!
        if (!byCampaign.has(cid)) byCampaign.set(cid, [])
        byCampaign.get(cid)!.push(lead)
      }

      for (const [instantlyCampaignId, campaignEmailLeads] of byCampaign) {
        try {
          const analytics = await instantlyService.getCampaignAnalytics(instantlyCampaignId)
          const leadStatuses = await instantlyService.listLeads(instantlyCampaignId, 1000)
          // Build statusMap keyed by lowercased email for case-insensitive lookup.
          const statusMap = new Map<string, typeof leadStatuses[number]>()
          for (const ls of leadStatuses) {
            if (ls.email) statusMap.set(ls.email.toLowerCase(), ls)
          }

          for (const lead of campaignEmailLeads) {
            const key = (lead.email ?? '').toLowerCase()
            const status = statusMap.get(key)
            if (!status) {
              // BUG-009: lead.email may have been updated by FullEnrich AFTER it was
              // pushed to Instantly with the old email. Without a stored
              // instantly_lead_id we cannot reliably re-match; surface the gap.
              console.warn(`[tracker] Email status not found for lead ${lead.id} (${lead.email}) in Instantly campaign ${instantlyCampaignId}; reply tracking may be incomplete.`)
              continue
            }

            const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
            let changed = false

            if (status.status === 'bounced' && !lead.emailBouncedAt) {
              updates.emailBouncedAt = status.bounced_at ?? new Date().toISOString()
              updates.emailStatus = 'bounced'
              changed = true
            }
            if (status.replied_at && !lead.emailRepliedAt) {
              updates.emailRepliedAt = status.replied_at
              updates.emailStatus = 'replied'
              updates.lifecycleStatus = 'Replied'
              updates.repliedAt = status.replied_at
              changed = true

              fireWebhooks('reply.received', { campaignId: campaign.id, leadId: lead.id, channel: 'email' })
              sendSlackNotification('reply', {
                campaignId: campaign.id,
                campaignTitle: campaign.title,
                leadName: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
                leadId: lead.id,
              })
            } else if (status.opened_at && !lead.emailOpenedAt) {
              updates.emailOpenedAt = status.opened_at
              updates.emailStatus = 'opened'
              changed = true
            } else if (status.status === 'active' && lead.emailStatus !== 'sent') {
              updates.emailStatus = 'sent'
              updates.emailSentAt = lead.emailSentAt ?? new Date().toISOString()
              changed = true
            }

            if (changed) {
              try {
                await db.transaction(async (tx) => {
                  await tx.update(campaignLeads).set(updates).where(and(leadScope(), eq(campaignLeads.id, lead.id)))
                })
                summary.emailsTracked++
              } catch (err) {
                console.error(`[tracker] Failed email update for ${lead.email}:`, err)
              }
            }
          }

          console.log(`[tracker] Email tracking: ${analytics.emails_sent} sent, ${analytics.emails_read} opened, ${analytics.replies} replies, ${analytics.bounced} bounced`)
        } catch (err) {
          console.error(`[tracker] Failed to poll Instantly campaign ${instantlyCampaignId}:`, err)
        }
      }
    }
  }

  // Phase 9: Log summary
  console.log('\n─── Tracker Summary ───')
  console.log(`Campaigns activated:    ${summary.campaignsActivated}`)
  console.log(`Campaigns skipped:      ${summary.campaignsSkipped}`)
  console.log(`Campaigns processed:    ${summary.campaignsProcessed}`)
  console.log(`Connections accepted:    ${summary.connectionsAccepted}`)
  console.log(`Replies detected:       ${summary.repliesDetected}`)
  console.log(`DM1s sent:              ${summary.dm1sSent}`)
  console.log(`DM2s sent:              ${summary.dm2sSent}`)
  console.log(`Connections sent:       ${summary.connectionsSent}`)
  console.log(`Leads expired:          ${summary.leadsExpired}`)
  console.log(`Emails enriched:        ${summary.emailsEnriched}`)
  console.log(`Emails queued:          ${summary.emailsQueued}`)
  console.log(`Emails tracked:         ${summary.emailsTracked}`)

  return summary
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkAcceptances(
  tenantId: string,
  accountId: string,
  leads: typeof campaignLeads.$inferSelect[],
  dryRun: boolean
): Promise<number> {
  const leadScope = () => eq(campaignLeads.tenantId, tenantId)
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
          try {
            await db.transaction(async (tx) => {
              await tx.update(campaignLeads).set({
                lifecycleStatus: 'Connected',
                connectedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))
            })
          } catch (err) {
            console.error(`[tracker] Failed to update acceptance for ${lead.firstName} ${lead.lastName}:`, err)
            continue
          }
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
  tenantId: string,
  accountId: string,
  leads: typeof campaignLeads.$inferSelect[],
  dryRun: boolean
): Promise<{ count: number; repliedLeadIds: Set<string> }> {
  const leadScope = () => eq(campaignLeads.tenantId, tenantId)
  let count = 0
  const repliedLeadIds = new Set<string>()
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
          try {
            await db.transaction(async (tx) => {
              await tx.update(campaignLeads).set({
                lifecycleStatus: 'Replied',
                repliedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }).where(and(leadScope(), eq(campaignLeads.id, lead.id)))
            })
          } catch (err) {
            console.error(`[tracker] Failed to update reply for ${lead.firstName} ${lead.lastName}:`, err)
            continue
          }
        }
        repliedLeadIds.add(lead.id)
        count++
      }
    }
  } catch (err) {
    console.error('[tracker] Error checking replies:', err)
  }
  return { count, repliedLeadIds }
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

function scheduleToInstantly(schedule: ReturnType<typeof parseSchedule>): { timezone?: string; days?: Record<string, { start: string; end: string }> } | undefined {
  if (!schedule) return undefined
  // Map active days (1=Mon..7=Sun) to Instantly's day names
  const dayKey: Record<number, string> = { 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday', 6: 'saturday', 7: 'sunday' }
  const days: Record<string, { start: string; end: string }> = {}
  for (const d of schedule.activeDays) {
    const key = dayKey[d]
    if (key) days[key] = { start: schedule.sendWindow.start, end: schedule.sendWindow.end }
  }
  return { timezone: schedule.timezone, days }
}

function parseChannels(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map(String)
    if (typeof parsed === 'string') return [parsed]
  } catch {
    // Not JSON — treat as comma-separated
    return raw.split(',').map(s => s.trim()).filter(Boolean)
  }
  return []
}
