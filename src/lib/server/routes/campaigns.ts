import { Hono } from 'hono'
import { eq, desc, sql, and } from 'drizzle-orm'
import { db } from '../../db'
import { campaigns, campaignLeads, campaignVariants, campaignContent } from '../../db/schema'
import { CampaignManager } from '../../campaign/manager'
import type { CampaignStatus } from '../../campaign/types'
import { fireWebhooks } from '../../services/webhooks'

const manager = new CampaignManager()

export const campaignRoutes = new Hono()

// Monthly report across campaigns
campaignRoutes.get('/monthly-report', async (c) => {
  const month = c.req.query('month') ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  try {
    const { loadConfig } = await import('../../config/loader')
    const config = loadConfig(
      (process.env.GTM_OS_CONFIG ?? '~/.gtm-os/config.yaml').replace('~', process.env.HOME!),
    )
    const { generateMonthlyReport } = await import('../../campaign/monthly-report')
    const report = await generateMonthlyReport({ config, month })
    return c.json(report)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

// List all campaigns with metrics + funnel counts
campaignRoutes.get('/', async (c) => {
  const status = c.req.query('status') as CampaignStatus | undefined
  const campaignList = await manager.list(status || undefined)

  const enriched = await Promise.all(
    campaignList.map(async (campaign) => {
      // Get lead funnel counts grouped by lifecycle status
      const leadRows = await db
        .select({
          lifecycleStatus: campaignLeads.lifecycleStatus,
          count: sql<number>`count(*)`,
        })
        .from(campaignLeads)
        .where(eq(campaignLeads.campaignId, campaign.id))
        .groupBy(campaignLeads.lifecycleStatus)

      const funnel: Record<string, number> = {}
      let leadCount = 0
      for (const row of leadRows) {
        funnel[row.lifecycleStatus] = row.count
        leadCount += row.count
      }

      // Get variant count
      const variants = await db
        .select({ id: campaignVariants.id })
        .from(campaignVariants)
        .where(eq(campaignVariants.campaignId, campaign.id))

      // Get metrics
      const metrics = await manager.getMetrics(campaign.id)

      return {
        id: campaign.id,
        title: campaign.title,
        status: campaign.status,
        hypothesis: campaign.hypothesis,
        targetSegment: campaign.targetSegment,
        channels: campaign.channels,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        leadCount,
        variantCount: variants.length,
        metrics,
        funnel,
      }
    })
  )

  return c.json({ campaigns: enriched })
})

// Get single campaign with variant details
campaignRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  const metrics = await manager.getMetrics(id)
  const breakdown = await manager.getMetricsBreakdown(id)

  // Get full variant details
  const variants = await db
    .select()
    .from(campaignVariants)
    .where(eq(campaignVariants.campaignId, id))

  // Get campaign row for LinkedIn-specific fields
  const campaignRow = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, id))
    .limit(1)

  // Get lead funnel counts
  const leadRows = await db
    .select({
      lifecycleStatus: campaignLeads.lifecycleStatus,
      count: sql<number>`count(*)`,
    })
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, id))
    .groupBy(campaignLeads.lifecycleStatus)

  const funnel: Record<string, number> = {}
  let leadCount = 0
  for (const row of leadRows) {
    funnel[row.lifecycleStatus] = row.count
    leadCount += row.count
  }

  return c.json({
    ...campaign,
    leadCount,
    metrics,
    breakdown,
    funnel,
    experimentStatus: campaignRow[0]?.experimentStatus ?? null,
    winnerVariant: campaignRow[0]?.winnerVariant ?? null,
    variants: variants.map((v) => ({
      id: v.id,
      name: v.name,
      status: v.status,
      connectNote: v.connectNote,
      dm1Template: v.dm1Template,
      dm2Template: v.dm2Template,
      sends: v.sends ?? 0,
      accepts: v.accepts ?? 0,
      acceptRate: v.acceptRate ?? 0,
      dmsSent: v.dmsSent ?? 0,
      replies: v.replies ?? 0,
      replyRate: v.replyRate ?? 0,
    })),
  })
})

// Get campaign report with 7 sections
campaignRoutes.get('/:id/report', async (c) => {
  const id = c.req.param('id')
  try {
    const { generateCampaignReport } = await import('../../campaign/intelligence-report')
    const report = await generateCampaignReport(id)
    return c.json(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: message }, 404)
  }
})

// Get leads with timeline data for a campaign
campaignRoutes.get('/:id/leads', async (c) => {
  const id = c.req.param('id')

  // Verify campaign exists
  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  // Get all leads for this campaign
  const leads = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, id))
    .orderBy(desc(campaignLeads.updatedAt))

  // Get variants for name lookup
  const variants = await db
    .select()
    .from(campaignVariants)
    .where(eq(campaignVariants.campaignId, id))

  const variantMap = new Map(variants.map((v) => [v.id, v.name]))

  return c.json({
    leads: leads.map((lead) => ({
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      headline: lead.headline,
      company: lead.company,
      linkedinUrl: lead.linkedinUrl,
      lifecycleStatus: lead.lifecycleStatus,
      variantId: lead.variantId,
      variantName: lead.variantId ? variantMap.get(lead.variantId) ?? null : null,
      qualificationScore: lead.qualificationScore,
      source: lead.source,
      connectSentAt: lead.connectSentAt,
      connectedAt: lead.connectedAt,
      dm1SentAt: lead.dm1SentAt,
      dm2SentAt: lead.dm2SentAt,
      repliedAt: lead.repliedAt,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
    })),
  })
})

// Get single lead detail with content (DMs sent)
campaignRoutes.get('/:id/leads/:leadId', async (c) => {
  const campaignId = c.req.param('id')
  const leadId = c.req.param('leadId')

  const leadRows = await db
    .select()
    .from(campaignLeads)
    .where(and(eq(campaignLeads.id, leadId), eq(campaignLeads.campaignId, campaignId)))
    .limit(1)

  if (leadRows.length === 0) return c.json({ error: 'Lead not found' }, 404)
  const lead = leadRows[0]

  // Get variant details
  let variant = null
  if (lead.variantId) {
    const variantRows = await db
      .select()
      .from(campaignVariants)
      .where(eq(campaignVariants.id, lead.variantId))
      .limit(1)
    if (variantRows.length > 0) {
      variant = {
        name: variantRows[0].name,
        connectNote: variantRows[0].connectNote,
        dm1Template: variantRows[0].dm1Template,
        dm2Template: variantRows[0].dm2Template,
      }
    }
  }

  // Get content (actual DMs sent to this lead)
  const content = await db
    .select()
    .from(campaignContent)
    .where(and(eq(campaignContent.campaignId, campaignId), eq(campaignContent.targetLeadId, leadId)))

  return c.json({
    ...lead,
    tags: lead.tags ?? [],
    variant,
    content: content.map((c) => ({
      contentType: c.contentType,
      content: c.content,
      status: c.status,
      sentAt: c.sentAt,
    })),
  })
})

// Pause a campaign
campaignRoutes.post('/:id/pause', async (c) => {
  const id = c.req.param('id')
  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
  await manager.pause(id)
  return c.json({ ok: true })
})

// Resume a campaign
campaignRoutes.post('/:id/resume', async (c) => {
  const id = c.req.param('id')
  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
  await manager.resume(id)
  return c.json({ ok: true })
})

// Update lead lifecycle status (manual statuses only)
campaignRoutes.patch('/:id/leads/:leadId', async (c) => {
  const campaignId = c.req.param('id')
  const leadId = c.req.param('leadId')
  const body = await c.req.json<{ lifecycleStatus: string }>()

  const allowed = ['Demo_Booked', 'Deal_Created', 'Closed_Won', 'Closed_Lost']
  if (!allowed.includes(body.lifecycleStatus)) {
    return c.json({ error: `Status must be one of: ${allowed.join(', ')}` }, 400)
  }

  const leadRows = await db
    .select()
    .from(campaignLeads)
    .where(and(eq(campaignLeads.id, leadId), eq(campaignLeads.campaignId, campaignId)))
    .limit(1)

  if (leadRows.length === 0) return c.json({ error: 'Lead not found' }, 404)

  const oldStatus = leadRows[0].lifecycleStatus

  await db
    .update(campaignLeads)
    .set({ lifecycleStatus: body.lifecycleStatus, updatedAt: new Date().toISOString() })
    .where(eq(campaignLeads.id, leadId))

  // Fire webhooks
  fireWebhooks('lead.status_changed', { campaignId, leadId, oldStatus, newStatus: body.lifecycleStatus })

  return c.json({ ok: true, leadId, newStatus: body.lifecycleStatus })
})

// Timeline data grouped by ISO week for charts
campaignRoutes.get('/:id/timeline', async (c) => {
  const id = c.req.param('id')

  const leads = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, id))

  // Group events by ISO week
  const weekMap = new Map<string, Record<string, number>>()
  const eventFields = [
    { key: 'connectSentAt', name: 'connect_sent' },
    { key: 'connectedAt', name: 'connected' },
    { key: 'dm1SentAt', name: 'dm1_sent' },
    { key: 'dm2SentAt', name: 'dm2_sent' },
    { key: 'repliedAt', name: 'replied' },
  ] as const

  for (const lead of leads) {
    for (const field of eventFields) {
      const val = lead[field.key]
      if (!val) continue
      const d = new Date(val)
      const week = getISOWeek(d)
      if (!weekMap.has(week)) weekMap.set(week, {})
      const events = weekMap.get(week)!
      events[field.name] = (events[field.name] || 0) + 1
    }
  }

  const weeks = Array.from(weekMap.entries())
    .map(([week, events]) => ({ week, events }))
    .sort((a, b) => a.week.localeCompare(b.week))

  return c.json({ weeks })
})

// Campaign Chat — Claude-powered Q&A
campaignRoutes.post('/:id/chat', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ message: string }>()

  if (!body.message?.trim()) {
    return c.json({ error: 'Message is required' }, 400)
  }

  // Load campaign data
  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  const variants = await db
    .select()
    .from(campaignVariants)
    .where(eq(campaignVariants.campaignId, id))

  const leads = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, id))

  // Build context string
  const leadsByStatus: Record<string, number> = {}
  for (const l of leads) {
    leadsByStatus[l.lifecycleStatus] = (leadsByStatus[l.lifecycleStatus] || 0) + 1
  }

  const contextStr = [
    `Campaign: ${campaign.title}`,
    `Status: ${campaign.status}`,
    `Hypothesis: ${campaign.hypothesis}`,
    `Target Segment: ${campaign.targetSegment || 'N/A'}`,
    `Total Leads: ${leads.length}`,
    `Lead Status Breakdown: ${JSON.stringify(leadsByStatus)}`,
    '',
    'Variants:',
    ...variants.map(v =>
      `- ${v.name}: ${v.sends} sends, ${((v.acceptRate ?? 0) * 100).toFixed(1)}% accept, ${v.dmsSent} DMs, ${((v.replyRate ?? 0) * 100).toFixed(1)}% reply`
    ),
    '',
    'Leads:',
    ...leads.slice(0, 100).map(l =>
      `- ${l.firstName} ${l.lastName} | ${l.company || 'N/A'} | ${l.lifecycleStatus} | Score: ${l.qualificationScore ?? 'N/A'} | Replied: ${l.repliedAt || 'No'}`
    ),
  ].join('\n')

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const anthropic = new Anthropic()

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: 'You are a campaign analyst. Answer questions about this LinkedIn outreach campaign using only the data provided. Be concise and specific. Include numbers.',
      messages: [
        { role: 'user', content: `Campaign data:\n${contextStr}\n\nQuestion: ${body.message}` },
      ],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => 'text' in b ? b.text : '')
      .join('')

    return c.json({ response: text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return c.json({ error: `Chat failed: ${message}` }, 500)
  }
})

// CSV Export
campaignRoutes.get('/:id/export', async (c) => {
  const id = c.req.param('id')
  const format = c.req.query('format')
  if (format !== 'csv') return c.json({ error: 'Only format=csv is supported' }, 400)

  const campaign = await manager.get(id)
  if (!campaign) return c.json({ error: 'Campaign not found' }, 404)

  const leads = await db
    .select()
    .from(campaignLeads)
    .where(eq(campaignLeads.campaignId, id))
    .orderBy(desc(campaignLeads.updatedAt))

  const variants = await db
    .select()
    .from(campaignVariants)
    .where(eq(campaignVariants.campaignId, id))

  const variantMap = new Map(variants.map((v) => [v.id, v.name]))

  const csvEsc = (val: string | null | undefined) => {
    if (!val) return ''
    if (val.includes(',') || val.includes('"') || val.includes('\n')) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return val
  }

  const header = 'Name,Company,Headline,LinkedIn URL,Variant,Lifecycle Status,Score,Connect Sent,Connected,DM1 Sent,DM2 Sent,Replied'
  const rows = leads.map(l => [
    csvEsc([l.firstName, l.lastName].filter(Boolean).join(' ')),
    csvEsc(l.company),
    csvEsc(l.headline),
    csvEsc(l.linkedinUrl),
    csvEsc(l.variantId ? variantMap.get(l.variantId) ?? '' : ''),
    csvEsc(l.lifecycleStatus),
    l.qualificationScore ?? '',
    l.connectSentAt ?? '',
    l.connectedAt ?? '',
    l.dm1SentAt ?? '',
    l.dm2SentAt ?? '',
    l.repliedAt ?? '',
  ].join(','))

  const csv = [header, ...rows].join('\n')
  const safeTitle = campaign.title.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50)

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="campaign-${safeTitle}-leads.csv"`,
    },
  })
})

function getISOWeek(date: Date): string {
  const d = new Date(date.getTime())
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const week1 = new Date(d.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
