import { SignalCollector, getCollector } from './collector'
import { PatternDetector } from './detector'
import { IntelligenceStore } from '../intelligence/store'
import { ReviewQueue } from '../review/queue'

interface DetectionResult {
  newHypotheses: number
  upgrades: number
  pendingReviews: number
}

export async function runPatternDetection(): Promise<DetectionResult> {
  const collector = getCollector()
  const store = new IntelligenceStore()
  const detector = new PatternDetector()
  const reviewQueue = new ReviewQueue()

  // 1. Load signals from last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const signals = await collector.getRecent(since)

  if (signals.length === 0) {
    return { newHypotheses: 0, upgrades: 0, pendingReviews: 0 }
  }

  // 2. Load existing intelligence
  const existingIntelligence = await store.query({})

  // 3. Detect patterns
  const patterns = await detector.detect(signals, existingIntelligence)

  let newHypotheses = 0
  let upgrades = 0
  let pendingReviews = 0

  // 4. Process each pattern
  for (const pattern of patterns) {
    if (pattern.isUpgrade && pattern.upgradeTargetId) {
      // Upgrade existing intelligence confidence
      await store.updateConfidence(pattern.upgradeTargetId)
      upgrades++
    } else {
      // New hypothesis — save with auto_derived flag
      await store.add({
        category: pattern.category,
        insight: pattern.insight,
        evidence: pattern.evidence,
        segment: pattern.segment ?? null,
        channel: pattern.channel ?? null,
        confidence: 'hypothesis',
        source: 'implicit',
        biasCheck: null,
        supersedes: null,
        validatedAt: null,
        expiresAt: null,
      })
      newHypotheses++
    }

    // If high confidence (>60), create a review request for human confirmation
    if (pattern.suggestedConfidence > 60) {
      await reviewQueue.create({
        type: 'intelligence_confirmation',
        title: `Confirm: ${pattern.insight.slice(0, 80)}`,
        description: `Pattern detected from ${signals.length} signals with ${pattern.suggestedConfidence}% confidence.\n\nInsight: ${pattern.insight}\nCategory: ${pattern.category}${pattern.segment ? `\nSegment: ${pattern.segment}` : ''}`,
        sourceSystem: 'learning_loop',
        sourceId: pattern.upgradeTargetId ?? 'new',
        priority: pattern.suggestedConfidence > 80 ? 'high' : 'normal',
        payload: { pattern, signalCount: signals.length },
        action: null,
        nudgeEvidence: null,
        reviewedAt: null,
        reviewNotes: null,
        expiresAt: null,
      })
      pendingReviews++
    }
  }

  return { newHypotheses, upgrades, pendingReviews }
}
