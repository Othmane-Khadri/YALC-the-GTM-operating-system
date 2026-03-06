import type { GTMFramework } from './types'
import { IntelligenceStore } from '../intelligence/store'

/**
 * Build a prompt-ready context string from the GTM Framework.
 * Injected into Claude's system prompt to personalize every interaction.
 */
export async function buildFrameworkContext(framework: GTMFramework | null): Promise<string> {
  if (!framework || !framework.onboardingComplete) {
    return `## Company Context
No company context loaded yet. The user hasn't completed onboarding. If they describe a GTM goal, ask them about their business first — who they sell to, their value proposition, and their target channels. This helps you propose better workflows.`
  }

  const sections: string[] = ['## Your Company Context']

  // ─── Company Identity ─────────────────────────────────────────
  const c = framework.company
  if (c.name) {
    sections.push(
      `### Company: ${c.name}` +
      (c.industry ? ` (${c.industry}${c.subIndustry ? ` / ${c.subIndustry}` : ''})` : '') +
      (c.stage ? ` — ${c.stage}` : '') +
      (c.teamSize ? ` — ${c.teamSize} people` : '')
    )
    if (c.description) sections.push(c.description)
  }

  // ─── Positioning ──────────────────────────────────────────────
  const p = framework.positioning
  if (p.valueProp) {
    sections.push(`### Positioning`)
    sections.push(`**Value prop:** ${p.valueProp}`)
    if (p.category) sections.push(`**Category:** ${p.category}`)
    if (p.differentiators.length > 0) {
      sections.push(`**Differentiators:** ${p.differentiators.join(', ')}`)
    }
    if (p.proofPoints.length > 0) {
      sections.push(`**Proof points:** ${p.proofPoints.join(', ')}`)
    }
    if (p.competitors.length > 0) {
      sections.push(
        `**Competitors:** ${p.competitors.map((comp) => `${comp.name} (${comp.positioning})`).join('; ')}`
      )
    }
  }

  // ─── Primary ICP Segment ──────────────────────────────────────
  const primary = framework.segments.find((s) => s.priority === 'primary')
  if (primary) {
    sections.push(`### Primary ICP: ${primary.name}`)
    if (primary.description) sections.push(primary.description)
    if (primary.targetRoles.length > 0) {
      sections.push(`**Target roles:** ${primary.targetRoles.join(', ')}`)
    }
    if (primary.painPoints.length > 0) {
      sections.push(`**Pain points:** ${primary.painPoints.join(', ')}`)
    }
    if (primary.voice.tone) {
      sections.push(`**Voice:** ${primary.voice.tone} — ${primary.voice.style}`)
    }
    if (primary.voice.avoidPhrases.length > 0) {
      sections.push(`**Avoid phrases:** ${primary.voice.avoidPhrases.join(', ')}`)
    }
    if (primary.messaging.elevatorPitch) {
      sections.push(`**Elevator pitch:** ${primary.messaging.elevatorPitch}`)
    }
  }

  // ─── Secondary Segments (brief) ───────────────────────────────
  const secondary = framework.segments.filter((s) => s.priority !== 'primary')
  if (secondary.length > 0) {
    sections.push(
      `### Other Segments: ${secondary.map((s) => s.name).join(', ')}`
    )
  }

  // ─── Signals & Intent ─────────────────────────────────────────
  const sig = framework.signals
  if (sig.buyingIntentSignals.length > 0 || sig.triggerEvents.length > 0) {
    sections.push(`### Buying Signals`)
    if (sig.buyingIntentSignals.length > 0) {
      sections.push(`**Intent signals:** ${sig.buyingIntentSignals.join(', ')}`)
    }
    if (sig.triggerEvents.length > 0) {
      sections.push(`**Trigger events:** ${sig.triggerEvents.join(', ')}`)
    }
    if (sig.monitoringKeywords.length > 0) {
      sections.push(`**Monitoring keywords:** ${sig.monitoringKeywords.join(', ')}`)
    }
  }

  // ─── Structured Intelligence (proven + validated) ─────────────
  const primarySegment = primary?.name
  try {
    const store = new IntelligenceStore()
    const entries = await store.getForPrompt(primarySegment)

    if (entries.length > 0) {
      sections.push(`### Intelligence`)
      entries.forEach(entry => {
        const timeSpan = entry.evidence.length >= 2
          ? Math.round(
              (Math.max(...entry.evidence.map(e => new Date(e.timestamp).getTime()))
                - Math.min(...entry.evidence.map(e => new Date(e.timestamp).getTime())))
              / (1000 * 60 * 60 * 24)
            )
          : 0

        sections.push(
          `[${entry.confidence.toUpperCase()}] [${entry.category}]\n${entry.insight}\nBased on ${entry.evidence.length} data points across ${timeSpan} days`
        )
      })
    }
  } catch {
    // Intelligence table may not exist yet — fall through to legacy
  }

  // ─── Legacy Learnings (backward compat) ─────────────────────
  const validated = framework.learnings.filter((l) => l.confidence !== 'hypothesis')
  if (validated.length > 0) {
    sections.push(`### Campaign Learnings (legacy)`)
    validated.slice(-5).forEach((l) => {
      sections.push(`- ${l.insight} (${l.confidence})`)
    })
  }

  // ─── Connected Providers ──────────────────────────────────────
  if (framework.connectedProviders.length > 0) {
    sections.push(
      `### Connected Providers: ${framework.connectedProviders.join(', ')}`
    )
  }

  return sections.join('\n\n')
}
