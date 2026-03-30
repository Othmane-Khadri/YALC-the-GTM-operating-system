import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { frameworks } from '../db/schema'
import type { GTMFramework } from './types'
import { IntelligenceStore } from '../intelligence/store'

const FRAMEWORK_PATH = join(homedir(), '.gtm-os', 'framework.yaml')

/**
 * Load framework from DB, fallback to YAML file.
 */
export async function loadFramework(): Promise<GTMFramework | null> {
  // Try DB first
  try {
    const rows = await db.select().from(frameworks).where(eq(frameworks.userId, 'default')).limit(1)
    if (rows.length > 0) {
      const data = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data
      return data as GTMFramework
    }
  } catch {
    // DB may not have table yet
  }

  // Fallback to YAML
  if (existsSync(FRAMEWORK_PATH)) {
    try {
      const raw = readFileSync(FRAMEWORK_PATH, 'utf-8')
      return yaml.load(raw) as GTMFramework
    } catch {
      return null
    }
  }

  return null
}

/**
 * Save framework to both DB and YAML file.
 */
export async function saveFramework(framework: GTMFramework): Promise<void> {
  const now = new Date()

  // Save to DB
  try {
    const existing = await db.select().from(frameworks).where(eq(frameworks.userId, 'default')).limit(1)
    if (existing.length > 0) {
      await db.update(frameworks).set({
        data: JSON.stringify(framework),
        onboardingComplete: framework.onboardingComplete ?? false,
        updatedAt: now,
      }).where(eq(frameworks.userId, 'default'))
    } else {
      await db.insert(frameworks).values({
        id: crypto.randomUUID(),
        userId: 'default',
        data: JSON.stringify(framework),
        onboardingComplete: framework.onboardingComplete ?? false,
        createdAt: now,
        updatedAt: now,
      })
    }
  } catch (err) {
    console.error('[framework] DB save failed:', err)
  }

  // Save to YAML
  try {
    const dir = join(homedir(), '.gtm-os')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(FRAMEWORK_PATH, yaml.dump(framework))
  } catch (err) {
    console.error('[framework] YAML save failed:', err)
  }
}

/**
 * Merge partial updates into existing framework.
 */
export async function updateFramework(partial: Partial<GTMFramework>): Promise<GTMFramework> {
  const existing = await loadFramework()
  if (!existing) throw new Error('No framework found. Run onboard first.')

  const updated: GTMFramework = {
    ...existing,
    ...partial,
    company: { ...existing.company, ...partial.company },
    positioning: { ...existing.positioning, ...partial.positioning },
    signals: { ...existing.signals, ...partial.signals },
    channels: { ...existing.channels, ...partial.channels },
    lastUpdated: new Date().toISOString(),
    version: existing.version + 1,
  }

  // Merge segments and other arrays only if provided
  if (partial.segments) updated.segments = partial.segments
  if (partial.objections) updated.objections = partial.objections
  if (partial.learnings) updated.learnings = partial.learnings
  if (partial.connectedProviders) updated.connectedProviders = partial.connectedProviders

  await saveFramework(updated)
  return updated
}

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
