import { CampaignOptimizer } from '@/lib/campaign/optimizer'
import { ReviewQueue } from '@/lib/review/queue'

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const optimizer = new CampaignOptimizer()
  const reviewQueue = new ReviewQueue()

  const [nudges, abVerdicts] = await Promise.all([
    optimizer.analyze(id),
    optimizer.checkAbTestVerdicts(id),
  ])

  // Create review requests for each nudge
  for (const nudge of nudges) {
    await reviewQueue.create({
      type: 'nudge',
      title: `Nudge: ${nudge.recommendation.slice(0, 80)}`,
      description: `${nudge.insight}\n\nRecommendation: ${nudge.recommendation}`,
      sourceSystem: 'campaign_optimizer',
      sourceId: id,
      priority: nudge.impact.confidence > 70 ? 'high' : 'normal',
      payload: { campaignId: id, nudge },
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
  }

  return Response.json({ nudges, abVerdicts })
}
