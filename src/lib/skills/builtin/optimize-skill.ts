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
    required: ['skillId'],
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
      samples: providedSamples,
      outputType = 'prose',
      generateSamples: shouldGenerate = false,
      basePrompt,
      sampleCount = 20,
      persistToStore = false,
    } = input as {
      skillId: string
      samples?: {
        id: number
        content: string
        dimensions: Record<string, string>
      }[]
      outputType?: string
      generateSamples?: boolean
      basePrompt?: string
      sampleCount?: number
      persistToStore?: boolean
    }

    let samples = providedSamples ?? []

    // Auto-generate samples if requested
    if (shouldGenerate && samples.length === 0) {
      if (!basePrompt) {
        yield { type: 'error', message: 'basePrompt is required when generateSamples is true.' }
        return
      }
      yield { type: 'progress', message: `Generating ${sampleCount} varied samples...`, percent: 5 }
      const { generateSamples: genFn } = await import('../../rl/sample-generator')
      samples = await genFn(basePrompt, outputType as any, sampleCount)
      yield { type: 'progress', message: `Generated ${samples.length} samples`, percent: 8 }
    }

    if (!samples || samples.length === 0) {
      yield { type: 'error', message: 'No samples provided. Set generateSamples: true with basePrompt, or provide samples array.' }
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

    // Phase D: Analyze with preference extractor
    const resultsData = JSON.parse(readFileSync(resultsPath, 'utf-8'))
    const swipeResults = resultsData.results as {
      id: number
      verdict: 'like' | 'dislike'
      comment: string | null
      time_spent_ms: number
    }[]

    const { analyzePreferences, persistToIntelligenceStore } = await import('../../rl/preference-extractor')
    const analysis = analyzePreferences(swipeResults, samples)

    yield { type: 'progress', message: `Found ${analysis.rules.length} preference rules`, percent: 80 }

    // Persist to Intelligence Store if requested
    if (persistToStore) {
      const persisted = await persistToIntelligenceStore(skillId, analysis)
      yield { type: 'progress', message: `Persisted ${persisted} rules to Intelligence Store`, percent: 90 }
    }

    yield { type: 'progress', message: 'Analysis complete', percent: 95 }

    // Phase E: Emit results
    const liked = swipeResults.filter((r) => r.verdict === 'like')
    const disliked = swipeResults.filter((r) => r.verdict === 'dislike')

    const summary = {
      sessionId,
      totalSamples: samples.length,
      liked: liked.length,
      disliked: disliked.length,
      comments: analysis.commentInsights.length,
      rules: analysis.rules,
      commentFeedback: analysis.commentInsights,
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
