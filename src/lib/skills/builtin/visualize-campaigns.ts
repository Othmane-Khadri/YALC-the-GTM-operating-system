import type { Skill, SkillEvent, SkillContext } from '../types'
import { eq, desc, sql } from 'drizzle-orm'
import { db } from '../../db'
import { campaigns, campaignLeads, campaignVariants } from '../../db/schema'
import { CampaignManager } from '../../campaign/manager'
import type { CampaignStatus } from '../../campaign/types'

export const visualizeCampaignsSkill: Skill = {
  id: 'visualize-campaigns',
  name: 'Visualize Campaigns',
  version: '1.0.0',
  description: 'Launch a visual dashboard showing campaign status, per-lead timelines, and variant performance. Opens in browser.',
  category: 'analysis',
  inputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string', description: 'Specific campaign ID to view (optional — shows all if omitted)' },
      status: { type: 'string', description: 'Filter by status: active, paused, draft, completed' },
      port: { type: 'number', description: 'Server port', default: 3847 },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      campaigns: { type: 'array', items: { type: 'object' } },
      summary: { type: 'object' },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { campaignId, status, port = 3847 } = input as {
      campaignId?: string
      status?: CampaignStatus
      port?: number
    }

    yield { type: 'progress', message: 'Querying campaign data...', percent: 10 }

    const manager = new CampaignManager()

    // If a specific campaign was requested, get its detail
    if (campaignId) {
      const campaign = await manager.get(campaignId)
      if (!campaign) {
        yield { type: 'error', message: `Campaign ${campaignId} not found` }
        return
      }

      const metrics = await manager.getMetrics(campaignId)
      const variants = await db.select().from(campaignVariants)
        .where(eq(campaignVariants.campaignId, campaignId))
      const leads = await db.select().from(campaignLeads)
        .where(eq(campaignLeads.campaignId, campaignId))
        .orderBy(desc(campaignLeads.updatedAt))

      yield { type: 'progress', message: 'Starting dashboard server...', percent: 60 }

      // Start server and open browser
      const url = await startAndOpen(port, `/campaigns/${campaignId}`)

      yield { type: 'progress', message: 'Dashboard open in browser.', percent: 100 }
      yield {
        type: 'result',
        data: {
          url,
          campaign: {
            id: campaign.id,
            title: campaign.title,
            status: campaign.status,
            leadCount: leads.length,
            variantCount: variants.length,
            metrics,
          },
          summary: `Viewing "${campaign.title}" — ${leads.length} leads, ${variants.length} variants`,
        },
      }
      return
    }

    // Otherwise, list all campaigns
    const campaignList = await manager.list(status || undefined)

    yield { type: 'progress', message: `Found ${campaignList.length} campaigns. Loading stats...`, percent: 30 }

    const enriched = await Promise.all(
      campaignList.map(async (c) => {
        const leadRows = await db
          .select({
            lifecycleStatus: campaignLeads.lifecycleStatus,
            count: sql<number>`count(*)`,
          })
          .from(campaignLeads)
          .where(eq(campaignLeads.campaignId, c.id))
          .groupBy(campaignLeads.lifecycleStatus)

        let leadCount = 0
        let replied = 0
        let demos = 0
        for (const row of leadRows) {
          leadCount += row.count
          if (row.lifecycleStatus === 'Replied') replied += row.count
          if (['Demo_Booked', 'Deal_Created', 'Closed_Won'].includes(row.lifecycleStatus)) demos += row.count
        }

        const variants = await db.select({ id: campaignVariants.id })
          .from(campaignVariants)
          .where(eq(campaignVariants.campaignId, c.id))

        return {
          id: c.id,
          title: c.title,
          status: c.status,
          leadCount,
          replied,
          demos,
          variantCount: variants.length,
        }
      })
    )

    yield { type: 'progress', message: 'Starting dashboard server...', percent: 70 }

    const url = await startAndOpen(port, '/campaigns')

    const totalLeads = enriched.reduce((s, c) => s + c.leadCount, 0)
    const totalReplied = enriched.reduce((s, c) => s + c.replied, 0)
    const totalDemos = enriched.reduce((s, c) => s + c.demos, 0)
    const active = enriched.filter(c => c.status === 'active').length

    yield { type: 'progress', message: 'Dashboard open in browser.', percent: 100 }
    yield {
      type: 'result',
      data: {
        url,
        campaigns: enriched,
        summary: {
          totalCampaigns: enriched.length,
          active,
          totalLeads,
          totalReplied,
          totalDemos,
        },
      },
    }
  },
}

async function startAndOpen(port: number, path: string): Promise<string> {
  const url = `http://localhost:${port}${path}`

  try {
    // Check if server is already running
    const res = await fetch(`http://localhost:${port}/`)
    if (res.ok) {
      // Server already running, just open browser
      const { execFile } = await import('child_process')
      execFile('open', [url])
      return url
    }
  } catch {
    // Server not running, start it
  }

  const { startServer } = await import('../../server/index')
  startServer(port)

  const { execFile } = await import('child_process')
  execFile('open', [url])

  return url
}
