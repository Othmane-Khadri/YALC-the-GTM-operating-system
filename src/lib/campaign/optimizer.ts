import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import { CampaignManager } from './manager'
import { IntelligenceStore } from '../intelligence/store'
import type { Nudge, NudgeCategory, AbTestVerdict } from './nudge-types'
import type { Campaign, CampaignMetrics } from './types'

export class CampaignOptimizer {
  private manager = new CampaignManager()
  private intelligence = new IntelligenceStore()

  async analyze(campaignId: string): Promise<Nudge[]> {
    // 1. Load campaign
    const campaign = await this.manager.get(campaignId)
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

    // 2. Load metrics
    const metrics = await this.manager.getMetrics(campaignId)
    const breakdown = await this.manager.getMetricsBreakdown(campaignId)

    // 3. Load relevant intelligence
    const intel = await this.intelligence.getForPrompt(campaign.targetSegment ?? undefined)

    // 4. Call Claude with structured analysis
    const generateNudgesTool: Anthropic.Tool = {
      name: 'generate_nudges',
      description: 'Generate specific, actionable optimization nudges based on campaign performance data.',
      input_schema: {
        type: 'object' as const,
        properties: {
          nudges: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                category: {
                  type: 'string' as const,
                  enum: ['audience', 'content', 'timing', 'channel', 'volume', 'icp', 'ab_verdict', 'campaign_health'],
                },
                insight: { type: 'string' as const, description: 'What the OS noticed — be specific with numbers' },
                recommendation: { type: 'string' as const, description: 'What to do about it — actionable' },
                evidenceMetric: { type: 'string' as const },
                evidenceCurrent: { type: 'number' as const },
                evidenceComparison: { type: 'number' as const },
                evidenceSource: { type: 'string' as const },
                impactMetric: { type: 'string' as const },
                impactCurrentValue: { type: 'number' as const },
                impactProjectedValue: { type: 'number' as const },
                impactConfidence: { type: 'number' as const, description: '0-100' },
              },
              required: ['category', 'insight', 'recommendation', 'evidenceMetric', 'evidenceCurrent', 'evidenceComparison', 'evidenceSource', 'impactMetric', 'impactCurrentValue', 'impactProjectedValue', 'impactConfidence'],
            },
          },
        },
        required: ['nudges'],
      },
    }

    const campaignSummary = this.buildCampaignSummary(campaign, metrics, breakdown, intel)

    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      system: `You are a GTM campaign optimization engine. Analyze campaign metrics and generate specific, evidence-backed nudges. Each nudge must cite real numbers from the data. Be conservative — only suggest changes with clear evidence. If data is from mock providers or sample sizes are small, say so explicitly.`,
      tools: [generateNudgesTool],
      tool_choice: { type: 'tool', name: 'generate_nudges' },
      messages: [{ role: 'user', content: campaignSummary }],
    })

    // Extract tool use result
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'generate_nudges') {
        const input = block.input as { nudges: Array<{
          category: NudgeCategory
          insight: string
          recommendation: string
          evidenceMetric: string
          evidenceCurrent: number
          evidenceComparison: number
          evidenceSource: string
          impactMetric: string
          impactCurrentValue: number
          impactProjectedValue: number
          impactConfidence: number
        }> }

        return input.nudges.map(n => ({
          category: n.category,
          insight: n.insight,
          recommendation: n.recommendation,
          evidence: [{
            metric: n.evidenceMetric,
            current: n.evidenceCurrent,
            comparison: n.evidenceComparison,
            source: n.evidenceSource,
          }],
          impact: {
            metric: n.impactMetric,
            currentValue: n.impactCurrentValue,
            projectedValue: n.impactProjectedValue,
            confidence: n.impactConfidence,
          },
          action: {
            endpoint: `/api/campaigns/${campaignId}`,
            method: 'PATCH',
            body: { action: 'resume' },
          },
          alternatives: [],
          showDataEndpoint: `/api/campaigns/${campaignId}`,
        }))
      }
    }

    return []
  }

  async analyzeAllActive(): Promise<{ campaignId: string; nudges: Nudge[] }[]> {
    const activeCampaigns = await this.manager.list('active')
    const results: { campaignId: string; nudges: Nudge[] }[] = []

    for (const campaign of activeCampaigns) {
      try {
        const nudges = await this.analyze(campaign.id)
        results.push({ campaignId: campaign.id, nudges })
      } catch (err) {
        console.error(`[CampaignOptimizer] Failed to analyze campaign ${campaign.id}:`, err)
      }
    }

    return results
  }

  async checkAbTestVerdicts(campaignId: string): Promise<AbTestVerdict[]> {
    const breakdown = await this.manager.getMetricsBreakdown(campaignId)
    const variants = Object.entries(breakdown.byVariant)
    const verdicts: AbTestVerdict[] = []

    // Compare each pair of variants
    for (let i = 0; i < variants.length; i++) {
      for (let j = i + 1; j < variants.length; j++) {
        const [nameA, metricsA] = variants[i]
        const [nameB, metricsB] = variants[j]

        const rateA = metricsA.sent > 0 ? metricsA.replied / metricsA.sent : 0
        const rateB = metricsB.sent > 0 ? metricsB.replied / metricsB.sent : 0

        const significant = Math.abs(rateA - rateB) > 0 &&
          (rateA > 0 && rateB > 0) &&
          (Math.max(rateA, rateB) / Math.min(rateA, rateB) >= 2) &&
          metricsA.sent >= 50 && metricsB.sent >= 50

        verdicts.push({
          variantA: nameA,
          variantB: nameB,
          winner: significant ? (rateA > rateB ? nameA : nameB) : null,
          metric: 'reply_rate',
          aValue: rateA,
          bValue: rateB,
          sampleSizeA: metricsA.sent,
          sampleSizeB: metricsB.sent,
          significant,
        })
      }
    }

    return verdicts
  }

  private buildCampaignSummary(
    campaign: Campaign,
    metrics: CampaignMetrics,
    breakdown: { byStep: Record<string, CampaignMetrics>; byChannel: Record<string, CampaignMetrics>; byVariant: Record<string, CampaignMetrics> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    intel: any[],
  ): string {
    const parts = [
      `## Campaign: ${campaign.title}`,
      `Hypothesis: ${campaign.hypothesis}`,
      `Status: ${campaign.status}`,
      `Channels: ${campaign.channels.join(', ')}`,
      `Segment: ${campaign.targetSegment ?? 'N/A'}`,
      '',
      `## Overall Metrics`,
      `Total Leads: ${metrics.totalLeads}`,
      `Qualified: ${metrics.qualified}`,
      `Sent: ${metrics.sent}`,
      `Opened: ${metrics.opened}`,
      `Replied: ${metrics.replied}`,
      `Converted: ${metrics.converted}`,
      `Bounced: ${metrics.bounced}`,
      '',
      `## Success Metrics (targets)`,
      ...campaign.successMetrics.map(m =>
        `- ${m.metric}: target=${m.target}, actual=${m.actual ?? 'N/A'}, baseline=${m.baseline}`
      ),
    ]

    if (Object.keys(breakdown.byChannel).length > 0) {
      parts.push('', '## By Channel')
      for (const [ch, m] of Object.entries(breakdown.byChannel)) {
        parts.push(`- ${ch}: sent=${m.sent}, replied=${m.replied}, converted=${m.converted}`)
      }
    }

    if (Object.keys(breakdown.byVariant).length > 0) {
      parts.push('', '## By Variant')
      for (const [v, m] of Object.entries(breakdown.byVariant)) {
        parts.push(`- ${v}: sent=${m.sent}, replied=${m.replied}, converted=${m.converted}`)
      }
    }

    if (intel.length > 0) {
      parts.push('', '## Relevant Intelligence')
      for (const i of intel) {
        parts.push(`- [${i.confidence}] ${i.insight}`)
      }
    }

    parts.push('', 'Analyze this data and generate actionable nudges. Be specific with numbers.')

    return parts.join('\n')
  }
}
