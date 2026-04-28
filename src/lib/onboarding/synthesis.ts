/**
 * Synthesis writer (0.6.0).
 *
 * Produces a populated preview folder from a captured `CompanyContext` plus
 * the raw scraped sources. Each section is written individually so
 * `--regenerate <section>` can re-run a single section without rewriting
 * untouched files.
 *
 * When an Anthropic key is available the section bodies come from the LLM
 * via `runSectionPrompt()`; otherwise we emit human-readable placeholder
 * stubs that the user (or Claude Code parent) can fill in by re-running
 * with a key. Either path produces files at the right paths so commit can
 * promote them as-is.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { CompanyContext } from '../framework/context-types.js'
import {
  ensurePreviewDir,
  previewPath,
  readPreviewMeta,
  writePreviewMeta,
  type PreviewSectionMeta,
  type SectionName,
  type TenantContext,
} from './preview.js'
import {
  SECTION_PROMPT_BUILDERS,
  parseConfidenceField,
  runSectionPrompt,
  type SectionId,
  type SectionPromptInput,
} from '../framework/section-prompts/index.js'
import {
  computeConfidence,
  DEFAULT_LLM_SELF_RATING,
  type ConfidenceSignals,
} from './confidence.js'

export interface SynthesisOptions {
  context: CompanyContext
  rawSources?: SectionPromptInput['rawSources']
  tenant?: TenantContext
  /** Limit synthesis to a subset of sections — used by `--regenerate`. */
  only?: SectionId[]
  /** User hint forwarded to every section prompt. */
  hint?: string
  /**
   * True when website auto-extract surfaced rich metadata anchors
   * (og:site_name, <title>, <meta description>). Drives the per-section
   * `has_metadata_anchors` flag in 0.8.F confidence scoring.
   */
  hasMetadataAnchors?: boolean
}

const ALL_SECTIONS: SectionId[] = [
  'framework',
  'voice',
  'icp',
  'positioning',
  'qualification_rules',
  'campaign_templates',
  'search_queries',
]

function hasAnthropic(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/** Stub bodies written when no LLM is available. */
function stubBody(section: SectionId, ctx: CompanyContext): string {
  switch (section) {
    case 'framework':
      return yaml.dump({
        company: { name: ctx.company.name, website: ctx.company.website },
        positioning: { valueProp: '', differentiators: [], competitors: ctx.icp.competitors },
        segments: [],
        signals: { buyingIntentSignals: [], triggerEvents: [], monitoringKeywords: [] },
        onboardingComplete: false,
      })
    case 'voice':
      return [
        '# Tone of voice (placeholder)',
        '',
        ctx.voice.description || 'Voice description not yet captured. Add ANTHROPIC_API_KEY and run `yalc-gtm start --regenerate voice` to extract from samples.',
        '---END---',
        '# Examples (placeholder)',
        '',
        '_No examples extracted yet._',
      ].join('\n')
    case 'icp':
      return yaml.dump({
        segments: [
          {
            id: 'primary',
            name: 'Primary segment (placeholder)',
            description: ctx.icp.segments_freeform || 'Captured ICP summary will go here.',
            priority: 'primary',
            target_roles: [],
            target_industries: [],
            pain_points: ctx.icp.pain_points,
            disqualifiers: [],
          },
        ],
      })
    case 'positioning':
      return [
        '# One-pager (placeholder)',
        '',
        `Company: ${ctx.company.name || '(unknown)'}`,
        '',
        '## Value prop',
        '_Run `yalc-gtm start --regenerate positioning` with an Anthropic key to synthesize._',
        ...(ctx.icp.competitors.length > 0
          ? ctx.icp.competitors.flatMap((c) => [
              `---BATTLECARD: ${c.toLowerCase().replace(/[^a-z0-9]+/g, '-')}---`,
              `# Battlecard: ${c}`,
              '',
              '_Awaiting synthesis._',
            ])
          : []),
      ].join('\n')
    case 'qualification_rules':
      return [
        '# Qualification rules (placeholder)',
        '',
        '(?i)(cto|ceo|vp|director|head of)',
        '(?i)(engineering|product|growth|marketing)',
        '',
        '## Disqualifiers',
        '- student',
        '- intern',
      ].join('\n')
    case 'campaign_templates':
      return yaml.dump({
        connect_note: 'Hi {{first_name}}, just came across your work — would love to connect.',
        dm1_template: 'Hi {{first_name}} — quick question about {{company}}.',
        dm2_template: 'Hi {{first_name}}, following up — would a 15-min chat make sense?',
      })
    case 'search_queries':
      return [
        ctx.icp.segments_freeform || 'icp keyword 1',
        ...(ctx.icp.pain_points.length > 0 ? ctx.icp.pain_points : ['pain point query']),
      ]
        .filter(Boolean)
        .slice(0, 12)
        .join('\n')
  }
}

/**
 * Char-budget mapping from section → which raw sources contribute meaningful
 * grounding for that section. Voice cares about voice samples + LinkedIn;
 * ICP/positioning care about website + docs; etc. Used by 0.8.F confidence
 * scoring to feed `input_chars` per section. The values are simple sums of
 * the relevant `rawSources` strings — empty fields contribute zero.
 */
function inputCharsForSection(
  section: SectionId,
  raw: SectionPromptInput['rawSources'] | undefined,
): number {
  if (!raw) return 0
  const w = raw.website?.length ?? 0
  const l = raw.linkedin?.length ?? 0
  const d = raw.docs?.length ?? 0
  const v = raw.voice?.length ?? 0
  switch (section) {
    case 'voice':
      return v + l
    case 'framework':
      return w + l + d
    case 'icp':
    case 'positioning':
    case 'qualification_rules':
    case 'campaign_templates':
    case 'search_queries':
      return w + d
  }
}

interface SectionBodyResult {
  body: string
  /** LLM self-rating in 0..10, or null when no LLM call was made. */
  llmRating: number | null
  /** True when the body came from a real LLM completion (not the stub). */
  llmDriven: boolean
}

async function bodyForSection(
  section: SectionId,
  input: SectionPromptInput,
): Promise<SectionBodyResult> {
  if (!hasAnthropic()) {
    return { body: stubBody(section, input.context), llmRating: null, llmDriven: false }
  }
  const prompt = SECTION_PROMPT_BUILDERS[section](input)
  try {
    const raw = await runSectionPrompt(prompt)
    const parsed = parseConfidenceField(raw)
    const cleaned = parsed.body.trim()
    if (!cleaned) {
      return { body: stubBody(section, input.context), llmRating: null, llmDriven: false }
    }
    return { body: cleaned, llmRating: parsed.rating, llmDriven: true }
  } catch (err) {
    console.warn(
      `[synthesis] ${section} synthesis failed: ${err instanceof Error ? err.message : String(err)}. Using stub.`,
    )
    return { body: stubBody(section, input.context), llmRating: null, llmDriven: false }
  }
}

function writeFrameworkSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('framework.yaml', tenant)
  writeFileSync(previewPath('framework.yaml', tenant), body.endsWith('\n') ? body : `${body}\n`)
  return ['framework.yaml']
}

function writeVoiceSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('voice/tone-of-voice.md', tenant)
  ensurePreviewDir('voice/examples.md', tenant)
  const [tone, examples] = body.split(/^---END---\s*$/m)
  writeFileSync(previewPath('voice/tone-of-voice.md', tenant), (tone ?? '').trim() + '\n')
  writeFileSync(previewPath('voice/examples.md', tenant), (examples ?? '').trim() + '\n')
  return ['voice/tone-of-voice.md', 'voice/examples.md']
}

function writeIcpSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('icp/segments.yaml', tenant)
  writeFileSync(previewPath('icp/segments.yaml', tenant), body.endsWith('\n') ? body : `${body}\n`)
  return ['icp/segments.yaml']
}

/**
 * Parse `subreddits` and `target_communities` from the LLM-emitted ICP
 * YAML body. Tolerates the field being absent (returns empty arrays so
 * the caller can fall back to hardcoded defaults at framework runtime).
 */
export function extractAudienceHangouts(body: string): {
  subreddits: string[]
  target_communities: string[]
} {
  let parsed: unknown
  try {
    parsed = yaml.load(body)
  } catch {
    return { subreddits: [], target_communities: [] }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { subreddits: [], target_communities: [] }
  }
  const root = parsed as Record<string, unknown>
  const ah = (root.audience_hangouts ?? root.audienceHangouts) as Record<string, unknown> | undefined
  const subRaw = ah?.subreddits
  const commRaw = ah?.target_communities
  const norm = (xs: unknown): string[] =>
    Array.isArray(xs) ? xs.map((x) => String(x).replace(/^r\//, '').trim()).filter(Boolean) : []
  return { subreddits: norm(subRaw), target_communities: norm(commRaw) }
}

function writePositioningSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('positioning/one-pager.md', tenant)
  const written: string[] = []
  // Split the body into one-pager + per-battlecard chunks. The prompt
  // instructs the model to use `---BATTLECARD: <slug>---` separators.
  const parts = body.split(/^---BATTLECARD:\s*([a-zA-Z0-9_-]+)\s*---\s*$/m)
  // parts[0] = one-pager, then alternating slug, body pairs.
  const onePager = parts[0]?.trim() ?? body.trim()
  writeFileSync(previewPath('positioning/one-pager.md', tenant), `${onePager}\n`)
  written.push('positioning/one-pager.md')

  ensurePreviewDir('positioning/battlecards/_keep.md', tenant)
  for (let i = 1; i < parts.length; i += 2) {
    const slug = parts[i].trim().replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || `competitor-${(i + 1) / 2}`
    const card = (parts[i + 1] ?? '').trim()
    if (!card) continue
    const rel = `positioning/battlecards/${slug}.md`
    ensurePreviewDir(rel, tenant)
    writeFileSync(previewPath(rel, tenant), `${card}\n`)
    written.push(rel)
  }
  return written
}

function writeQualificationSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('qualification_rules.md', tenant)
  writeFileSync(previewPath('qualification_rules.md', tenant), body.endsWith('\n') ? body : `${body}\n`)
  return ['qualification_rules.md']
}

function writeCampaignSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('campaign_templates.yaml', tenant)
  writeFileSync(previewPath('campaign_templates.yaml', tenant), body.endsWith('\n') ? body : `${body}\n`)
  return ['campaign_templates.yaml']
}

function writeSearchQueriesSection(body: string, tenant?: TenantContext): string[] {
  ensurePreviewDir('search_queries.txt', tenant)
  writeFileSync(previewPath('search_queries.txt', tenant), body.endsWith('\n') ? body : `${body}\n`)
  return ['search_queries.txt']
}

const SECTION_WRITERS: Record<SectionId, (body: string, tenant?: TenantContext) => string[]> = {
  framework: writeFrameworkSection,
  voice: writeVoiceSection,
  icp: writeIcpSection,
  positioning: writePositioningSection,
  qualification_rules: writeQualificationSection,
  campaign_templates: writeCampaignSection,
  search_queries: writeSearchQueriesSection,
}

export interface SynthesisResult {
  written: string[]
  /** Sections we tried to synthesize. */
  sections: SectionId[]
  /** True when a real LLM call happened; false when stubs were used. */
  llmDriven: boolean
}

/**
 * Run synthesis for the requested sections (default: all). Writes each
 * section's files into the preview folder.
 */
export async function writeSynthesizedPreview(opts: SynthesisOptions): Promise<SynthesisResult> {
  const sections = (opts.only && opts.only.length > 0 ? opts.only : ALL_SECTIONS).filter((s) =>
    ALL_SECTIONS.includes(s),
  )

  const promptInput: SectionPromptInput = {
    context: opts.context,
    rawSources: opts.rawSources,
    hint: opts.hint,
  }

  const written: string[] = []
  // Per-section confidence accumulator — merged into `_meta.json#sections`
  // after all writes complete so a partial regeneration (`only: [...]`)
  // updates only the affected entries and leaves everything else intact.
  const sectionMetaUpdates: Record<string, PreviewSectionMeta> = {}
  let anyLlmDriven = false

  for (const section of sections) {
    const result = await bodyForSection(section, promptInput)
    if (result.llmDriven) anyLlmDriven = true

    const writer = SECTION_WRITERS[section]
    written.push(...writer(result.body, opts.tenant))
    if (section === 'icp') {
      const hangouts = extractAudienceHangouts(result.body)
      opts.context.icp.subreddits = hangouts.subreddits
      opts.context.icp.target_communities = hangouts.target_communities
    }

    const signals: ConfidenceSignals = {
      input_chars: inputCharsForSection(section, opts.rawSources),
      llm_self_rating: result.llmRating ?? DEFAULT_LLM_SELF_RATING,
      // Metadata anchors are derived from the website auto-extract. Voice
      // doesn't draw on website meta tags, so it never claims an anchor
      // even when one was found for the company name/description.
      has_metadata_anchors:
        section === 'voice' ? false : !!opts.hasMetadataAnchors,
    }
    sectionMetaUpdates[section] = {
      confidence: computeConfidence(signals),
      confidence_signals: signals,
    }
  }

  // Merge per-section confidence into `_meta.json`. Preserve any pre-existing
  // entries (so a `--regenerate icp` run doesn't wipe the framework score).
  if (Object.keys(sectionMetaUpdates).length > 0) {
    const existing = readPreviewMeta(opts.tenant) ?? {
      captured_at: new Date().toISOString(),
    }
    const mergedSections: Record<string, PreviewSectionMeta> = {
      ...(existing.sections ?? {}),
      ...sectionMetaUpdates,
    }
    writePreviewMeta({ ...existing, sections: mergedSections }, opts.tenant)
  }

  // Refresh the preview index whenever any section is regenerated so the
  // user sees up-to-date timestamps + descriptions.
  try {
    const { buildIndex } = await import('./index-builder.js')
    const { previewRoot } = await import('./preview.js')
    buildIndex(previewRoot(opts.tenant), true)
  } catch {
    // Index regeneration is best-effort; never block synthesis on it.
  }

  return { written, sections, llmDriven: anyLlmDriven }
}

export const ALL_SECTION_IDS = ALL_SECTIONS

/** Map a CLI-friendly section name to a synthesis SectionId. */
export function sectionNameToId(name: SectionName | SectionId): SectionId | null {
  if (name === 'company_context') return null
  return name as SectionId
}
