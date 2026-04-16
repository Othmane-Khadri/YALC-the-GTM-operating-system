// ─── Voice Injector ──────────────────────────────────────────────────────────
// Loads GTM Framework and extracts voice/messaging context for a segment.

import { loadFramework } from '../framework/context'
import type { SegmentVoice, SegmentMessaging } from '../framework/types'

export interface VoiceContext {
  segmentId: string
  segmentName: string
  voice: SegmentVoice
  messaging: SegmentMessaging
}

/**
 * Load voice context from GTM Framework for a specific segment.
 * Falls back to primary segment if no segmentId provided.
 */
export async function getVoiceContext(segmentId?: string): Promise<VoiceContext | null> {
  const framework = await loadFramework()
  if (!framework || !framework.segments || framework.segments.length === 0) return null

  let segment = segmentId
    ? framework.segments.find((s) => s.id === segmentId)
    : framework.segments.find((s) => s.priority === 'primary')

  if (!segment) segment = framework.segments[0]
  if (!segment) return null

  return {
    segmentId: segment.id,
    segmentName: segment.name,
    voice: segment.voice,
    messaging: segment.messaging,
  }
}

/**
 * Format voice context into a structured prompt block for Claude.
 */
export function formatVoicePrompt(voice: VoiceContext): string {
  const sections: string[] = []

  sections.push(`## Brand Voice Guidelines (Segment: ${voice.segmentName})`)

  if (voice.voice.tone) {
    sections.push(`**Tone:** ${voice.voice.tone}`)
  }
  if (voice.voice.style) {
    sections.push(`**Style:** ${voice.voice.style}`)
  }
  if (voice.voice.keyPhrases.length > 0) {
    sections.push(`**Key phrases to use:** ${voice.voice.keyPhrases.join(', ')}`)
  }
  if (voice.voice.avoidPhrases.length > 0) {
    sections.push(`**Phrases to AVOID:** ${voice.voice.avoidPhrases.join(', ')}`)
  }
  if (voice.voice.writingRules.length > 0) {
    sections.push(`**Writing rules:**\n${voice.voice.writingRules.map((r) => `- ${r}`).join('\n')}`)
  }
  if (voice.voice.exampleSentences.length > 0) {
    sections.push(`**Example sentences (match this style):**\n${voice.voice.exampleSentences.map((s) => `> ${s}`).join('\n')}`)
  }

  if (voice.messaging.elevatorPitch) {
    sections.push(`\n## Messaging Framework`)
    sections.push(`**Elevator pitch:** ${voice.messaging.elevatorPitch}`)
  }
  if (voice.messaging.keyMessages.length > 0) {
    sections.push(`**Key messages:** ${voice.messaging.keyMessages.join('; ')}`)
  }

  return sections.join('\n')
}
