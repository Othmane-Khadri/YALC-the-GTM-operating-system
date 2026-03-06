import Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client'
import type { Signal } from './types'
import type { Intelligence, IntelligenceCategory, Evidence } from '../intelligence/types'

export interface DetectedPattern {
  insight: string
  category: IntelligenceCategory
  segment?: string
  channel?: string
  evidence: Evidence[]
  suggestedConfidence: number
  isUpgrade: boolean
  upgradeTargetId?: string
}

export class PatternDetector {
  async detect(signals: Signal[], existingIntelligence: Intelligence[]): Promise<DetectedPattern[]> {
    if (signals.length === 0) return []

    // Group signals by category for structured analysis
    const grouped: Record<string, Signal[]> = {}
    for (const sig of signals) {
      if (!grouped[sig.category]) grouped[sig.category] = []
      grouped[sig.category].push(sig)
    }

    const extractPatternsTool: Anthropic.Tool = {
      name: 'extract_patterns',
      description: 'Extract patterns and insights from the analyzed signals. Return new intelligence entries or confidence upgrades to existing ones.',
      input_schema: {
        type: 'object' as const,
        properties: {
          patterns: {
            type: 'array' as const,
            items: {
              type: 'object' as const,
              properties: {
                insight: { type: 'string' as const, description: 'The pattern or insight discovered' },
                category: { type: 'string' as const, enum: ['icp', 'channel', 'content', 'timing', 'provider', 'qualification', 'campaign', 'competitive'] },
                segment: { type: 'string' as const, description: 'Optional target segment' },
                channel: { type: 'string' as const, description: 'Optional channel' },
                suggestedConfidence: { type: 'number' as const, description: 'Confidence score 0-100' },
                isUpgrade: { type: 'boolean' as const, description: 'If true, this upgrades an existing intelligence entry' },
                upgradeTargetId: { type: 'string' as const, description: 'ID of the intelligence entry to upgrade (if isUpgrade=true)' },
              },
              required: ['insight', 'category', 'suggestedConfidence', 'isUpgrade'],
            },
          },
        },
        required: ['patterns'],
      },
    }

    const signalSummary = Object.entries(grouped).map(([category, sigs]) => {
      return `## Category: ${category} (${sigs.length} signals)\n${sigs.map(s =>
        `- [${s.type}] ${JSON.stringify(s.data)}`
      ).join('\n')}`
    }).join('\n\n')

    const existingSummary = existingIntelligence.length > 0
      ? existingIntelligence.map(i =>
        `- [${i.id}] ${i.category}: ${i.insight} (confidence: ${i.confidence}, score: ${i.confidenceScore})`
      ).join('\n')
      : 'No existing intelligence entries.'

    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      system: `You are analyzing user interaction signals from a GTM operating system. Your job is to detect patterns that can become actionable intelligence. Be conservative — only extract patterns with real supporting evidence from multiple signals. Prefer upgrading existing intelligence confidence over creating duplicates.`,
      tools: [extractPatternsTool],
      tool_choice: { type: 'tool', name: 'extract_patterns' },
      messages: [
        {
          role: 'user',
          content: `Analyze these signals and extract patterns:\n\n${signalSummary}\n\n## Existing Intelligence\n${existingSummary}\n\nExtract meaningful patterns. Only create new entries if no existing intelligence covers the same insight. If an existing entry covers a pattern, mark it as an upgrade.`,
        },
      ],
    })

    // Extract tool use result
    for (const block of response.content) {
      if (block.type === 'tool_use' && block.name === 'extract_patterns') {
        const input = block.input as { patterns: Array<{
          insight: string
          category: IntelligenceCategory
          segment?: string
          channel?: string
          suggestedConfidence: number
          isUpgrade: boolean
          upgradeTargetId?: string
        }> }

        return input.patterns.map(p => ({
          insight: p.insight,
          category: p.category,
          segment: p.segment,
          channel: p.channel,
          evidence: [{
            type: 'signal_analysis',
            sourceId: 'pattern_detector',
            metric: 'signal_count',
            value: signals.length,
            sampleSize: signals.length,
            timestamp: new Date().toISOString(),
          }],
          suggestedConfidence: p.suggestedConfidence,
          isUpgrade: p.isUpgrade,
          upgradeTargetId: p.upgradeTargetId,
        }))
      }
    }

    return []
  }
}
