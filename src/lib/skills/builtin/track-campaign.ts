import type { Skill, SkillEvent, SkillContext } from '../types'
import { db } from '../../db'
import { campaigns, campaignLeads } from '../../db/schema'
import { eq, and } from 'drizzle-orm'
import { unipileService } from '../../services/unipile'
import { DEFAULT_TENANT } from '../../tenant/index.js'
import { randomUUID } from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// track-campaign: register, check, follow-up, and report on outreach campaigns
//
// Actions:
//   register  — create a campaign record with contacts + invitation IDs
//   check     — poll Unipile relations to detect accepted connections
//   follow-up — send DM to accepted connections who haven't been messaged yet
//   report    — summary of acceptance rate, replies, meetings
//   list      — show all tracked campaigns with status
// ─────────────────────────────────────────────────────────────────────────────

interface CampaignContact {
  name: string
  company: string
  title: string
  providerId: string
  invitationId: string
  note?: string
  landingPage?: string
}

interface RegisterInput {
  action: 'register'
  name: string
  signal?: string
  linkedinAccountId: string
  contacts: CampaignContact[]
}

interface CheckInput {
  action: 'check'
  campaignId: string
  linkedinAccountId: string
}

interface FollowUpInput {
  action: 'follow-up'
  campaignId: string
  linkedinAccountId: string
  message: string
  dryRun?: boolean
}

interface ReportInput {
  action: 'report'
  campaignId?: string
}

interface ListInput {
  action: 'list'
}

type TrackCampaignInput = RegisterInput | CheckInput | FollowUpInput | ReportInput | ListInput

export const trackCampaignSkill: Skill = {
  id: 'track-campaign',
  name: 'Track Campaign',
  version: '1.0.0',
  description:
    'Register, monitor, and manage outreach campaigns. Track connection acceptance, trigger follow-up DMs, and report on campaign performance.',
  category: 'outreach',

  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['register', 'check', 'follow-up', 'report', 'list'],
        description: 'Action to perform',
      },
      name: { type: 'string', description: 'Campaign name (register only)' },
      signal: { type: 'string', description: 'Buying signal that triggered this campaign (register only)' },
      linkedinAccountId: { type: 'string', description: 'Unipile LinkedIn account ID' },
      campaignId: { type: 'string', description: 'Campaign ID (check/follow-up/report)' },
      contacts: {
        type: 'array',
        items: { type: 'object' },
        description: 'Contacts to track (register only)',
      },
      message: { type: 'string', description: 'Follow-up DM text (follow-up only)' },
      dryRun: { type: 'boolean', description: 'Preview without sending (follow-up only)' },
    },
    required: ['action'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      status: { type: 'string' },
      contacts: { type: 'array' },
      summary: { type: 'object' },
    },
  },

  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const params = input as TrackCampaignInput

    switch (params.action) {
      case 'register':
        yield* handleRegister(params)
        break
      case 'check':
        yield* handleCheck(params)
        break
      case 'follow-up':
        yield* handleFollowUp(params)
        break
      case 'report':
        yield* handleReport(params)
        break
      case 'list':
        yield* handleList()
        break
      default:
        yield { type: 'error', message: `Unknown action: ${(params as { action: string }).action}` }
    }
  },
}

// ─── Register ───────────────────────────────────────────────────────────────

async function* handleRegister(input: RegisterInput): AsyncIterable<SkillEvent> {
  const campaignId = randomUUID()
  const now = new Date().toISOString()

  yield { type: 'progress', message: `Registering campaign "${input.name}" with ${input.contacts.length} contacts...`, percent: 10 }

  // Create a dummy conversation ID for standalone campaigns
  await db.insert(campaigns).values({
    id: campaignId,
    tenantId: DEFAULT_TENANT,
    conversationId: campaignId,
    title: input.name,
    hypothesis: input.signal || 'Signal-based outreach campaign',
    status: 'active',
    channels: JSON.stringify(['linkedin']),
    successMetrics: JSON.stringify({ targetAcceptanceRate: 0.3, targetReplyRate: 0.1 }),
    metrics: JSON.stringify({ sent: input.contacts.length, accepted: 0, replied: 0 }),
    linkedinAccountId: input.linkedinAccountId,
    createdAt: now,
    updatedAt: now,
  })

  yield { type: 'progress', message: 'Inserting contact records...', percent: 40 }

  for (const contact of input.contacts) {
    await db.insert(campaignLeads).values({
      id: randomUUID(),
      tenantId: DEFAULT_TENANT,
      campaignId,
      providerId: contact.providerId,
      firstName: contact.name.split(' ')[0] || contact.name,
      lastName: contact.name.split(' ').slice(1).join(' ') || '',
      company: contact.company,
      headline: contact.title,
      linkedinUrl: `https://www.linkedin.com/in/${contact.providerId}`,
      lifecycleStatus: 'Connect_Sent',
      connectSentAt: now,
      // Store invitation ID and landing page in tags JSON array
      tags: JSON.stringify([
        `inv:${contact.invitationId}`,
        ...(contact.landingPage ? [`page:${contact.landingPage}`] : []),
        ...(contact.note ? [`note:${contact.note.slice(0, 100)}`] : []),
      ]),
      source: 'signal_campaign',
    })
  }

  yield { type: 'progress', message: 'Campaign registered.', percent: 100 }

  yield {
    type: 'result',
    data: {
      campaignId,
      name: input.name,
      contactCount: input.contacts.length,
      status: 'active',
      message: `Campaign "${input.name}" registered with ${input.contacts.length} contacts. Use action "check" to poll acceptance status.`,
    },
  }
}

// ─── Check ──────────────────────────────────────────────────────────────────

async function* handleCheck(input: CheckInput): AsyncIterable<SkillEvent> {
  yield { type: 'progress', message: 'Loading campaign leads...', percent: 5 }

  const leads = await db
    .select()
    .from(campaignLeads)
    .where(and(eq(campaignLeads.campaignId, input.campaignId), eq(campaignLeads.tenantId, DEFAULT_TENANT)))

  if (leads.length === 0) {
    yield { type: 'error', message: `No leads found for campaign ${input.campaignId}` }
    return
  }

  yield { type: 'progress', message: `Fetching LinkedIn relations to check ${leads.length} connections...`, percent: 10 }

  // Fetch all relations once (much cheaper than per-lead API calls)
  let relationsSet: Set<string> = new Set()
  try {
    const relations = await unipileService.listRelations(input.linkedinAccountId, 500)
    const items = (relations as { items?: Array<{ provider_id?: string }> })?.items || []
    relationsSet = new Set(items.map((r) => r.provider_id).filter(Boolean) as string[])
  } catch (err) {
    yield { type: 'error', message: `Failed to fetch relations: ${err instanceof Error ? err.message : String(err)}` }
    return
  }

  yield { type: 'progress', message: `Got ${relationsSet.size} relations. Checking leads...`, percent: 50 }

  let accepted = 0
  let pending = 0
  const updates: Array<{ name: string; company: string; status: string; changed: boolean }> = []

  for (const lead of leads) {
    const isConnected = relationsSet.has(lead.providerId)
    const currentStatus = lead.lifecycleStatus
    const alreadyAdvanced = ['Connected', 'DM1_Sent', 'DM2_Sent', 'Replied', 'Demo_Booked'].includes(currentStatus)

    if (isConnected && !alreadyAdvanced) {
      // Newly accepted
      await db
        .update(campaignLeads)
        .set({ lifecycleStatus: 'Connected', connectedAt: new Date().toISOString() })
        .where(eq(campaignLeads.id, lead.id))
      accepted++
      updates.push({ name: `${lead.firstName} ${lead.lastName}`.trim(), company: lead.company || '', status: 'Connected', changed: true })
    } else if (alreadyAdvanced) {
      accepted++
      updates.push({ name: `${lead.firstName} ${lead.lastName}`.trim(), company: lead.company || '', status: currentStatus, changed: false })
    } else {
      pending++
      updates.push({ name: `${lead.firstName} ${lead.lastName}`.trim(), company: lead.company || '', status: 'Connect_Sent', changed: false })
    }
  }

  // Update campaign metrics
  await db
    .update(campaigns)
    .set({
      metrics: JSON.stringify({ sent: leads.length, accepted, pending }),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(campaigns.id, input.campaignId))

  yield { type: 'progress', message: 'Status check complete.', percent: 100 }

  yield {
    type: 'result',
    data: {
      campaignId: input.campaignId,
      total: leads.length,
      accepted,
      pending,
      acceptanceRate: `${Math.round((accepted / leads.length) * 100)}%`,
      contacts: updates,
    },
  }
}

// ─── Follow-up ──────────────────────────────────────────────────────────────

async function* handleFollowUp(input: FollowUpInput): AsyncIterable<SkillEvent> {
  yield { type: 'progress', message: 'Loading accepted connections for follow-up...', percent: 5 }

  const leads = await db
    .select()
    .from(campaignLeads)
    .where(
      and(
        eq(campaignLeads.campaignId, input.campaignId),
        eq(campaignLeads.tenantId, DEFAULT_TENANT),
        eq(campaignLeads.lifecycleStatus, 'Connected'),
      ),
    )

  // Filter leads that haven't received DM1 yet
  const needsDM = leads.filter((l) => !l.dm1SentAt)

  if (needsDM.length === 0) {
    yield {
      type: 'result',
      data: { message: 'No accepted connections need follow-up. Either none accepted or all already received DM1.' },
    }
    return
  }

  yield {
    type: 'progress',
    message: `${needsDM.length} accepted connections ready for follow-up${input.dryRun ? ' (DRY RUN)' : ''}`,
    percent: 10,
  }

  const results: Array<{ name: string; company: string; sent: boolean; message: string }> = []

  for (let i = 0; i < needsDM.length; i++) {
    const lead = needsDM[i]
    const personalizedMsg = input.message
      .replace(/\{\{first_name\}\}/g, lead.firstName || '')
      .replace(/\{\{company\}\}/g, lead.company || '')
      .replace(/\{\{title\}\}/g, lead.headline || '')

    if (input.dryRun) {
      results.push({
        name: `${lead.firstName} ${lead.lastName}`.trim(),
        company: lead.company || '',
        sent: false,
        message: personalizedMsg,
      })
    } else {
      try {
        await unipileService.sendMessage(input.linkedinAccountId, lead.providerId, personalizedMsg)
        await db
          .update(campaignLeads)
          .set({ dm1SentAt: new Date().toISOString(), lifecycleStatus: 'DM1_Sent' })
          .where(eq(campaignLeads.id, lead.id))
        results.push({
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          company: lead.company || '',
          sent: true,
          message: personalizedMsg,
        })
      } catch (err) {
        results.push({
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          company: lead.company || '',
          sent: false,
          message: `Error: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    yield { type: 'progress', message: `Processed ${i + 1}/${needsDM.length}`, percent: 10 + Math.round((i / needsDM.length) * 85) }
  }

  yield { type: 'progress', message: 'Follow-up complete.', percent: 100 }
  yield { type: 'result', data: { dryRun: input.dryRun || false, total: needsDM.length, sent: results.filter((r) => r.sent).length, results } }
}

// ─── Report ─────────────────────────────────────────────────────────────────

async function* handleReport(input: ReportInput): AsyncIterable<SkillEvent> {
  yield { type: 'progress', message: 'Generating campaign report...', percent: 10 }

  const campaignList = input.campaignId
    ? await db.select().from(campaigns).where(eq(campaigns.id, input.campaignId))
    : await db.select().from(campaigns).where(eq(campaigns.tenantId, DEFAULT_TENANT))

  const reports = []

  for (const camp of campaignList) {
    const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, camp.id))

    const accepted = leads.filter((l) => ['Connected', 'DM1_Sent', 'DM2_Sent', 'Replied', 'Demo_Booked'].includes(l.lifecycleStatus))
    const replied = leads.filter((l) => l.lifecycleStatus === 'Replied')
    const dm1Sent = leads.filter((l) => l.dm1SentAt)

    reports.push({
      campaignId: camp.id,
      name: camp.title,
      signal: camp.hypothesis,
      status: camp.status,
      createdAt: camp.createdAt,
      metrics: {
        totalContacts: leads.length,
        accepted: accepted.length,
        acceptanceRate: leads.length > 0 ? `${Math.round((accepted.length / leads.length) * 100)}%` : '0%',
        replied: replied.length,
        replyRate: accepted.length > 0 ? `${Math.round((replied.length / accepted.length) * 100)}%` : '0%',
        dm1Sent: dm1Sent.length,
        pending: leads.filter((l) => l.lifecycleStatus === 'Connect_Sent').length,
      },
      contacts: leads.map((l) => ({
        name: `${l.firstName} ${l.lastName}`.trim(),
        company: l.company,
        title: l.headline,
        status: l.lifecycleStatus,
        connectSentAt: l.connectSentAt,
        connectedAt: l.connectedAt,
        dm1SentAt: l.dm1SentAt,
        repliedAt: l.repliedAt,
      })),
    })
  }

  yield { type: 'progress', message: 'Report generated.', percent: 100 }
  yield { type: 'result', data: reports.length === 1 ? reports[0] : { campaigns: reports, totalCampaigns: reports.length } }
}

// ─── List ───────────────────────────────────────────────────────────────────

async function* handleList(): AsyncIterable<SkillEvent> {
  yield { type: 'progress', message: 'Loading campaigns...', percent: 10 }

  const allCampaigns = await db.select().from(campaigns).where(eq(campaigns.tenantId, DEFAULT_TENANT))
  const summaries = []

  for (const camp of allCampaigns) {
    const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, camp.id))
    const metrics = typeof camp.metrics === 'string' ? JSON.parse(camp.metrics) : (camp.metrics || {})

    summaries.push({
      campaignId: camp.id,
      name: camp.title,
      status: camp.status,
      contacts: leads.length,
      accepted: metrics.accepted || 0,
      replied: metrics.replied || 0,
      createdAt: camp.createdAt,
    })
  }

  yield { type: 'progress', message: 'Done.', percent: 100 }
  yield { type: 'result', data: { campaigns: summaries, total: summaries.length } }
}
