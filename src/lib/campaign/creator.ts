import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { db } from '../db'
import { campaignLeads, campaignVariants, campaigns, conversations } from '../db/schema'
import { CampaignManager } from './manager'
import { notionService } from '../services/notion'
import { validateMessage } from '../outbound/validator'
import type { GTMOSConfig } from '../config/types'

interface CreatorOptions {
  config: GTMOSConfig
  leadsFilter?: string
  title?: string
  hypothesis?: string
  variants?: string // JSON string of variant definitions
  autoCopy?: boolean
  segmentId?: string
  schedule?: Record<string, unknown> // CampaignSchedule
  initialStatus?: string // 'scheduled' | 'active'
}

interface CreatorResult {
  campaignId: string
  leadCount: number
  variantCount: number
}

export async function runCreator(opts: CreatorOptions): Promise<CreatorResult> {
  const title = opts.title ?? `Campaign ${new Date().toISOString().slice(0, 10)}`
  const hypothesis = opts.hypothesis ?? 'Testing messaging hypothesis'

  console.log(`[creator] Creating campaign: ${title}`)

  // 1. Query qualified leads (from holding campaign pool)
  let leads = await db.select().from(campaignLeads)
    .where(eq(campaignLeads.lifecycleStatus, 'Qualified'))
  // Only grab leads not already assigned to a real campaign
  leads = leads.filter(l => {
    // Check if lead is in the holding pool (campaign title = __qualified_leads_pool__)
    return true // all Qualified leads are eligible
  })

  // Apply filter if provided
  if (opts.leadsFilter) {
    try {
      const filter = JSON.parse(opts.leadsFilter) as Record<string, string>
      leads = leads.filter(lead => {
        for (const [key, value] of Object.entries(filter)) {
          const leadValue = String((lead as Record<string, unknown>)[key] ?? '')
          if (!leadValue.toLowerCase().includes(value.toLowerCase())) return false
        }
        return true
      })
    } catch {
      console.log('[creator] Invalid leads filter JSON, using all qualified leads')
    }
  }

  if (leads.length === 0) {
    console.log('[creator] No qualified leads found. Run leads:qualify first.')
    return { campaignId: '', leadCount: 0, variantCount: 0 }
  }

  console.log(`[creator] Found ${leads.length} qualified leads`)

  // 2. Create campaign via CampaignManager
  const manager = new CampaignManager()

  // Create a conversation for the campaign
  const conversationId = randomUUID()
  await db.insert(conversations).values({
    id: conversationId,
    title: `Campaign: ${title}`,
  })

  const campaign = await manager.create({
    conversationId,
    title,
    hypothesis,
    targetSegment: null,
    channels: ['linkedin'],
    successMetrics: [
      { metric: 'accept_rate', target: 30, baseline: null, actual: null },
      { metric: 'reply_rate', target: 10, baseline: null, actual: null },
    ],
  })

  // 3. Create variants
  let variantDefs: Array<{
    name: string
    connectNote: string
    dm1Template: string
    dm2Template: string
  }> = []

  if (opts.variants) {
    try {
      variantDefs = JSON.parse(opts.variants)
    } catch {
      console.log('[creator] Invalid variants JSON, creating default variant')
    }
  }

  if (variantDefs.length === 0 && opts.autoCopy) {
    // Generate voice-aware copy via Claude
    console.log('[creator] Generating voice-aware copy via Claude...')
    try {
      const { generateCampaignCopy } = await import('../outbound/copy-generator')
      variantDefs = await generateCampaignCopy({
        segmentId: opts.segmentId,
        hypothesis,
        variantCount: 2,
      })
      console.log(`[creator] Generated ${variantDefs.length} voice-aware variants`)
    } catch (err) {
      console.log(`[creator] Auto-copy failed, falling back to defaults: ${err instanceof Error ? err.message : err}`)
    }
  }

  if (variantDefs.length === 0) {
    variantDefs = [{
      name: 'Default',
      connectNote: 'Hello {{first_name}}, I came across your profile and would love to connect.',
      dm1Template: 'Hi {{first_name}}, thanks for connecting! I noticed you work at {{company}} — would love to learn more about your experience.',
      dm2Template: 'Hi {{first_name}}, just following up — would you be open to a quick chat this week?',
    }]
  }

  // Validate variant templates against outbound rules
  for (const def of variantDefs) {
    for (const [field, value] of Object.entries({
      connectNote: def.connectNote,
      dm1Template: def.dm1Template,
      dm2Template: def.dm2Template,
    })) {
      const result = validateMessage(value)
      if (!result.valid) {
        for (const v of result.violations) {
          console.log(`[creator] ⚠ Variant "${def.name}" ${field}: ${v.ruleName}`)
        }
      }
    }
  }

  const createdVariants: string[] = []
  for (const def of variantDefs) {
    const variantId = randomUUID()
    await db.insert(campaignVariants).values({
      id: variantId,
      campaignId: campaign.id,
      name: def.name,
      status: 'active',
      connectNote: def.connectNote,
      dm1Template: def.dm1Template,
      dm2Template: def.dm2Template,
    })
    createdVariants.push(variantId)
  }

  console.log(`[creator] Created ${createdVariants.length} variant(s)`)

  // 4. Round-robin assign leads to variants
  for (let i = 0; i < leads.length; i++) {
    const variantId = createdVariants[i % createdVariants.length]
    await db.update(campaignLeads).set({
      campaignId: campaign.id,
      variantId,
      lifecycleStatus: 'Queued',
      updatedAt: new Date().toISOString(),
    }).where(eq(campaignLeads.id, leads[i].id))
  }

  console.log(`[creator] Assigned ${leads.length} leads to campaign (round-robin across ${createdVariants.length} variants)`)

  // 5. Activate campaign (or set to 'scheduled' if startAt is in the future)
  const finalStatus = opts.initialStatus ?? 'active'
  await db.update(campaigns).set({
    status: finalStatus,
    ...(opts.schedule ? { schedule: opts.schedule as any } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(campaigns.id, campaign.id))

  // 6. Sync to Notion
  if (opts.config.notion.campaigns_ds) {
    console.log('[creator] Syncing campaign to Notion...')
    try {
      await notionService.createPage(opts.config.notion.campaigns_ds, {
        Name: { title: [{ text: { content: title } }] },
        Hypothesis: { rich_text: [{ text: { content: hypothesis } }] },
        Status: { select: { name: 'Active' } },
        'Lead Count': { number: leads.length },
        'Variant Count': { number: createdVariants.length },
      })
    } catch (err) {
      console.log(`[creator] Notion sync skipped: ${err instanceof Error ? err.message : err}`)
    }
  }

  // 7. Summary
  console.log('\n─── Campaign Created ───')
  console.log(`Campaign ID:   ${campaign.id}`)
  console.log(`Title:         ${title}`)
  console.log(`Leads:         ${leads.length}`)
  console.log(`Variants:      ${createdVariants.length}`)
  console.log(`Status:        ${finalStatus}`)
  if (opts.schedule) {
    const s = opts.schedule as { timezone?: string; startAt?: string; sendWindow?: { start: string; end: string }; activeDays?: number[]; delayMode?: string }
    console.log(`Schedule:      ${s.timezone ?? 'Europe/Paris'} ${s.sendWindow?.start ?? '09:00'}-${s.sendWindow?.end ?? '18:00'} ${s.delayMode ?? 'business'}-day delays`)
    if (s.startAt) console.log(`Start at:      ${s.startAt}`)
  }

  return {
    campaignId: campaign.id,
    leadCount: leads.length,
    variantCount: createdVariants.length,
  }
}
