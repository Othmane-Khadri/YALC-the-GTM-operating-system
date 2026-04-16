// ─── Monthly Campaign Report ─────────────────────────────────────────────────
// Cross-campaign monthly aggregation with MoM trends and AI executive summary.

import { eq } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignLeads, campaignVariants } from '../db/schema'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import {
  buildFunnelSection,
  buildTagSection,
} from './report-sections'
import type { GTMOSConfig } from '../config/types'

export interface MonthlyOverview {
  month: string
  totalCampaigns: number
  totalLeads: number
  totalConnections: number
  totalAccepted: number
  totalDMs: number
  totalReplies: number
  totalDemos: number
  overallAcceptRate: number
  overallReplyRate: number
  overallConversionRate: number
}

export interface CampaignComparison {
  campaignId: string
  title: string
  leads: number
  acceptRate: number
  replyRate: number
  demos: number
}

export interface MonthOverMonth {
  acceptRateDelta: number
  replyRateDelta: number
  leadsDelta: number
}

export interface MonthlyReport {
  month: string
  overview: MonthlyOverview
  campaignComparison: CampaignComparison[]
  crossCampaignTags: Array<{ tag: string; count: number; acceptRate: number; replyRate: number }>
  monthOverMonth: MonthOverMonth | null
  executiveSummary: string | null
  recommendations: string[]
  generatedAt: string
}

export async function generateMonthlyReport(opts: {
  config: GTMOSConfig
  month: string // YYYY-MM
  campaignIds?: string[]
}): Promise<MonthlyReport> {
  const { month, campaignIds } = opts

  // Load campaigns active during this month
  let allCampaigns = await db.select().from(campaigns)

  if (campaignIds && campaignIds.length > 0) {
    allCampaigns = allCampaigns.filter((c) => campaignIds.includes(c.id))
  } else {
    // Include campaigns that were active/completed during the month
    allCampaigns = allCampaigns.filter((c) => {
      const created = c.createdAt?.slice(0, 7) ?? ''
      const updated = c.updatedAt?.slice(0, 7) ?? ''
      return created <= month && (updated >= month || c.status === 'active')
    })
  }

  // Load all leads for these campaigns
  const allLeads = []
  for (const campaign of allCampaigns) {
    const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, campaign.id))
    allLeads.push(...leads)
  }

  // Overview metrics
  const totalConnections = allLeads.filter((l) => l.connectSentAt).length
  const totalAccepted = allLeads.filter((l) => l.connectedAt).length
  const totalDMs = allLeads.filter((l) => l.dm1SentAt).length
  const totalReplies = allLeads.filter((l) => l.repliedAt).length
  const totalDemos = allLeads.filter((l) => l.lifecycleStatus === 'Demo_Booked').length

  const overview: MonthlyOverview = {
    month,
    totalCampaigns: allCampaigns.length,
    totalLeads: allLeads.length,
    totalConnections,
    totalAccepted,
    totalDMs,
    totalReplies,
    totalDemos,
    overallAcceptRate: totalConnections > 0 ? Math.round((totalAccepted / totalConnections) * 1000) / 10 : 0,
    overallReplyRate: totalDMs > 0 ? Math.round((totalReplies / totalDMs) * 1000) / 10 : 0,
    overallConversionRate: allLeads.length > 0 ? Math.round((totalDemos / allLeads.length) * 1000) / 10 : 0,
  }

  // Campaign comparison
  const campaignComparison: CampaignComparison[] = []
  for (const campaign of allCampaigns) {
    const cLeads = allLeads.filter((l) => l.campaignId === campaign.id)
    const sends = cLeads.filter((l) => l.connectSentAt).length
    const accepted = cLeads.filter((l) => l.connectedAt).length
    const dms = cLeads.filter((l) => l.dm1SentAt).length
    const replies = cLeads.filter((l) => l.repliedAt).length
    const demos = cLeads.filter((l) => l.lifecycleStatus === 'Demo_Booked').length

    campaignComparison.push({
      campaignId: campaign.id,
      title: campaign.title,
      leads: cLeads.length,
      acceptRate: sends > 0 ? Math.round((accepted / sends) * 1000) / 10 : 0,
      replyRate: dms > 0 ? Math.round((replies / dms) * 1000) / 10 : 0,
      demos,
    })
  }

  campaignComparison.sort((a, b) => b.replyRate - a.replyRate)

  // Cross-campaign tags
  const tagSection = buildTagSection(allLeads)

  // Month-over-month comparison
  let monthOverMonth: MonthOverMonth | null = null
  try {
    const prevMonth = getPreviousMonth(month)
    const prevCampaigns = (await db.select().from(campaigns)).filter((c) => {
      const created = c.createdAt?.slice(0, 7) ?? ''
      const updated = c.updatedAt?.slice(0, 7) ?? ''
      return created <= prevMonth && (updated >= prevMonth || c.status === 'active')
    })

    if (prevCampaigns.length > 0) {
      const prevLeads = []
      for (const c of prevCampaigns) {
        const leads = await db.select().from(campaignLeads).where(eq(campaignLeads.campaignId, c.id))
        prevLeads.push(...leads)
      }

      const prevSends = prevLeads.filter((l) => l.connectSentAt).length
      const prevAccepted = prevLeads.filter((l) => l.connectedAt).length
      const prevDMs = prevLeads.filter((l) => l.dm1SentAt).length
      const prevReplies = prevLeads.filter((l) => l.repliedAt).length

      const prevAcceptRate = prevSends > 0 ? (prevAccepted / prevSends) * 100 : 0
      const prevReplyRate = prevDMs > 0 ? (prevReplies / prevDMs) * 100 : 0

      monthOverMonth = {
        acceptRateDelta: Math.round((overview.overallAcceptRate - prevAcceptRate) * 10) / 10,
        replyRateDelta: Math.round((overview.overallReplyRate - prevReplyRate) * 10) / 10,
        leadsDelta: allLeads.length - prevLeads.length,
      }
    }
  } catch {
    // Previous month comparison optional
  }

  // Executive summary via Claude
  let executiveSummary: string | null = null
  const recommendations: string[] = []
  try {
    const anthropic = getAnthropicClient()
    const prompt = `Generate a concise monthly GTM report summary:

Month: ${month}
Campaigns: ${overview.totalCampaigns}
Total Leads: ${overview.totalLeads}
Accept Rate: ${overview.overallAcceptRate}%
Reply Rate: ${overview.overallReplyRate}%
Demos: ${overview.totalDemos}

Campaign Performance:
${campaignComparison.map((c) => `- ${c.title}: ${c.leads} leads, ${c.acceptRate}% accept, ${c.replyRate}% reply, ${c.demos} demos`).join('\n')}

${monthOverMonth ? `MoM: Accept ${monthOverMonth.acceptRateDelta > 0 ? '+' : ''}${monthOverMonth.acceptRateDelta}%, Reply ${monthOverMonth.replyRateDelta > 0 ? '+' : ''}${monthOverMonth.replyRateDelta}%, Leads ${monthOverMonth.leadsDelta > 0 ? '+' : ''}${monthOverMonth.leadsDelta}` : ''}

Return a JSON object: { "summary": "2-3 sentences", "recommendations": ["...", "...", "..."] }
Return ONLY the JSON.`

    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0])
      executiveSummary = parsed.summary
      recommendations.push(...(parsed.recommendations ?? []))
    }
  } catch {
    executiveSummary = null
  }

  return {
    month,
    overview,
    campaignComparison,
    crossCampaignTags: tagSection.tags.slice(0, 15),
    monthOverMonth,
    executiveSummary,
    recommendations,
    generatedAt: new Date().toISOString(),
  }
}

function getPreviousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number)
  const prev = new Date(year, m - 2, 1)
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`
}
