import type { Skill, SkillEvent, SkillContext } from '../types'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SESSION_DIR = join(tmpdir(), 'gtm-os-rl-sessions')

export const optimizeSkill: Skill = {
  id: 'optimize-skill',
  name: 'Optimize Skill (RL)',
  version: '1.0.0',
  description:
    'Improve any skill through reinforcement learning. Generates varied sample outputs, presents a Tinder-style swipe UI for binary preference feedback, analyzes patterns, and writes learned rules back to the skill.',
  category: 'analysis',
  inputSchema: {
    type: 'object',
    properties: {
      skillId: {
        type: 'string',
        description: 'ID of the skill to optimize',
      },
      samples: {
        type: 'array',
        description:
          'Pre-generated samples with id, content, and dimensions. If not provided, the caller must generate them.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            content: { type: 'string' },
            dimensions: { type: 'object' },
          },
        },
      },
      outputType: {
        type: 'string',
        enum: ['prose', 'config', 'strategy', 'visual'],
        description: 'Type of output the skill produces',
      },
      serverPort: {
        type: 'number',
        description: 'Port for the swipe UI server (default: 3847)',
      },
    },
    required: ['skillId', 'samples'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      totalSamples: { type: 'number' },
      liked: { type: 'number' },
      disliked: { type: 'number' },
      comments: { type: 'number' },
      rules: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            strength: { type: 'string' },
            dimension: { type: 'string' },
            description: { type: 'string' },
            spread: { type: 'number' },
          },
        },
      },
    },
  },
  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      skillId,
      samples,
      outputType = 'prose',
    } = input as {
      skillId: string
      samples: {
        id: number
        content: string
        dimensions: Record<string, string>
      }[]
      outputType?: string
    }

    if (!samples || samples.length === 0) {
      yield { type: 'error', message: 'No samples provided. Generate samples before running optimize-skill.' }
      return
    }

    // Phase A: Create session
    const sessionId = `${skillId}-${Date.now()}`
    const sessionDir = join(SESSION_DIR, sessionId)
    mkdirSync(sessionDir, { recursive: true })

    yield { type: 'progress', message: `Created RL session: ${sessionId}`, percent: 10 }

    // Save samples for the swipe UI to fetch
    const sessionData = {
      skill: skillId,
      output_type: outputType,
      generated_at: new Date().toISOString(),
      samples,
    }
    writeFileSync(join(sessionDir, 'samples.json'), JSON.stringify(sessionData, null, 2))

    yield { type: 'progress', message: `Saved ${samples.length} samples for review`, percent: 20 }

    // Phase B: Signal that the swipe UI is ready
    yield {
      type: 'approval_needed',
      title: 'Swipe Session Ready',
      description: `Open the swipe UI at /swipe/${sessionId} to review ${samples.length} samples. Swipe right to like, left to dislike. Submit when done.`,
      payload: { sessionId, sampleCount: samples.length, url: `/swipe/${sessionId}` },
    }

    yield { type: 'progress', message: 'Waiting for swipe results...', percent: 30 }

    // Phase C: Poll for results
    const resultsPath = join(sessionDir, 'results.json')
    const maxWait = 30 * 60 * 1000 // 30 minutes
    const pollInterval = 2000
    const startTime = Date.now()

    while (!existsSync(resultsPath)) {
      if (Date.now() - startTime > maxWait) {
        yield { type: 'error', message: 'Timed out waiting for swipe results (30 min).' }
        return
      }
      await new Promise((r) => setTimeout(r, pollInterval))
    }

    yield { type: 'progress', message: 'Results received! Analyzing patterns...', percent: 60 }

    // Phase D: Analyze patterns
    const resultsData = JSON.parse(readFileSync(resultsPath, 'utf-8'))
    const results: {
      id: number
      verdict: 'like' | 'dislike'
      comment: string | null
      time_spent_ms: number
    }[] = resultsData.results

    const liked = results.filter((r) => r.verdict === 'like')
    const disliked = results.filter((r) => r.verdict === 'dislike')
    const withComments = results.filter((r) => r.comment)

    // Build contingency tables per dimension
    const allDimensions = new Set<string>()
    for (const s of samples) {
      for (const key of Object.keys(s.dimensions || {})) {
        allDimensions.add(key)
      }
    }

    interface DimensionRule {
      strength: 'strong' | 'mild'
      dimension: string
      description: string
      spread: number
    }

    const rules: DimensionRule[] = []

    for (const dim of allDimensions) {
      const valueStats: Record<string, { liked: number; total: number }> = {}

      for (const result of results) {
        const sample = samples.find((s) => s.id === result.id)
        if (!sample) continue
        const val = sample.dimensions?.[dim]
        if (!val) continue

        if (!valueStats[val]) valueStats[val] = { liked: 0, total: 0 }
        valueStats[val].total++
        if (result.verdict === 'like') valueStats[val].liked++
      }

      const entries = Object.entries(valueStats)
      if (entries.length < 2) continue

      const rates = entries.map(([val, s]) => ({
        value: val,
        likeRate: s.total > 0 ? s.liked / s.total : 0,
        count: s.total,
      }))

      const maxRate = Math.max(...rates.map((r) => r.likeRate))
      const minRate = Math.min(...rates.map((r) => r.likeRate))
      const spread = (maxRate - minRate) * 100

      if (spread < 30) continue

      const best = rates.reduce((a, b) => (a.likeRate > b.likeRate ? a : b))
      const worst = rates.reduce((a, b) => (a.likeRate < b.likeRate ? a : b))

      const strength: 'strong' | 'mild' = spread > 60 ? 'strong' : 'mild'
      const desc = `Prefer "${best.value}" ${dim} (${Math.round(best.likeRate * 100)}% liked) over "${worst.value}" (${Math.round(worst.likeRate * 100)}% liked)`

      // Require minimum 3 samples per value for strong rules
      if (strength === 'strong' && (best.count < 3 || worst.count < 3)) continue

      rules.push({ strength, dimension: dim, description: desc, spread: Math.round(spread) })
    }

    yield { type: 'progress', message: `Found ${rules.length} preference rules`, percent: 80 }

    // Extract comment-based rules
    const commentRules: string[] = []
    for (const r of withComments) {
      if (r.comment) {
        const prefix = r.verdict === 'like' ? 'Liked' : 'Disliked'
        commentRules.push(`[${prefix}] "${r.comment}"`)
      }
    }

    yield { type: 'progress', message: 'Analysis complete', percent: 95 }

    // Phase E: Emit results
    const summary = {
      sessionId,
      totalSamples: samples.length,
      liked: liked.length,
      disliked: disliked.length,
      comments: withComments.length,
      rules,
      commentFeedback: commentRules,
    }

    yield {
      type: 'signal',
      signalType: 'rl_session_complete',
      data: summary,
    }

    yield {
      type: 'result',
      data: summary,
    }

    yield { type: 'progress', message: 'RL session complete.', percent: 100 }
  },
}
