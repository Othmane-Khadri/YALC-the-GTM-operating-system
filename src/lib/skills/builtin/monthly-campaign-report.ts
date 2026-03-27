import type { Skill, SkillEvent, SkillContext } from '../types'

export const monthlyCampaignReportSkill: Skill = {
  id: 'monthly-campaign-report',
  name: 'Monthly Campaign Report',
  version: '1.0.0',
  description:
    'Generate a cross-campaign monthly report with aggregate metrics, campaign comparison, MoM trends, and AI executive summary.',
  category: 'analysis',
  inputSchema: {
    type: 'object',
    properties: {
      month: { type: 'string', description: 'Month in YYYY-MM format' },
      campaignIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Specific campaign IDs (optional — includes all if omitted)',
      },
    },
    required: ['month'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      month: { type: 'string' },
      overview: { type: 'object' },
      campaignComparison: { type: 'array' },
      monthOverMonth: { type: 'object' },
      executiveSummary: { type: 'string' },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { month, campaignIds } = input as {
      month: string
      campaignIds?: string[]
    }

    yield { type: 'progress', message: `Generating monthly report for ${month}...`, percent: 10 }

    const { loadConfig } = await import('../../config/loader')
    const config = loadConfig(
      (process.env.GTM_OS_CONFIG ?? '~/.gtm-os/config.yaml').replace('~', process.env.HOME!),
    )

    const { generateMonthlyReport } = await import('../../campaign/monthly-report')
    const report = await generateMonthlyReport({ config, month, campaignIds })

    yield { type: 'progress', message: 'Report generated', percent: 90 }

    // Print summary
    const o = report.overview
    console.log(`\n═══ Monthly Report: ${month} ═══`)
    console.log(`Campaigns: ${o.totalCampaigns} | Leads: ${o.totalLeads}`)
    console.log(`Accept: ${o.overallAcceptRate}% | Reply: ${o.overallReplyRate}% | Conversion: ${o.overallConversionRate}%`)

    if (report.monthOverMonth) {
      const m = report.monthOverMonth
      const arrow = (v: number) => v > 0 ? `+${v}` : `${v}`
      console.log(`\nMoM: Accept ${arrow(m.acceptRateDelta)}% | Reply ${arrow(m.replyRateDelta)}% | Leads ${arrow(m.leadsDelta)}`)
    }

    if (report.campaignComparison.length > 0) {
      console.log('\n── Campaign Comparison ──')
      for (const c of report.campaignComparison) {
        console.log(`  ${c.title.padEnd(30)} ${c.leads} leads | ${c.acceptRate}% accept | ${c.replyRate}% reply | ${c.demos} demos`)
      }
    }

    if (report.executiveSummary) {
      console.log(`\n── Executive Summary ──\n${report.executiveSummary}`)
    }

    if (report.recommendations.length > 0) {
      console.log('\n── Recommendations ──')
      report.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`))
    }

    yield { type: 'result', data: report }
    yield { type: 'progress', message: 'Monthly report complete.', percent: 100 }
  },
}
