import { CampaignOptimizer } from '@/lib/campaign/optimizer'
import { ReviewQueue } from '@/lib/review/queue'

export async function POST() {
  const optimizer = new CampaignOptimizer()
  const reviewQueue = new ReviewQueue()

  const results = await optimizer.analyzeAllActive()

  let nudgesGenerated = 0

  for (const { campaignId, nudges } of results) {
    for (const nudge of nudges) {
      await reviewQueue.create({
        type: 'nudge',
        title: `Nudge: ${nudge.recommendation.slice(0, 80)}`,
        description: `${nudge.insight}\n\nRecommendation: ${nudge.recommendation}`,
        sourceSystem: 'campaign_optimizer',
        sourceId: campaignId,
        priority: nudge.impact.confidence > 70 ? 'high' : 'normal',
        payload: { campaignId, nudge },
        action: nudge.action,
        nudgeEvidence: {
          metrics: [{
            name: nudge.impact.metric,
            current: nudge.impact.currentValue,
            projected: nudge.impact.projectedValue,
          }],
          reasoning: nudge.insight,
          alternatives: nudge.alternatives.map(a => ({
            title: a.title,
            action: a.action,
          })),
          showDataEndpoint: nudge.showDataEndpoint,
        },
        reviewedAt: null,
        reviewNotes: null,
        expiresAt: null,
      })
      nudgesGenerated++
    }
  }

  return Response.json({
    analyzed: results.length,
    nudgesGenerated,
  })
}
