/**
 * Per-section synthesis prompts (0.6.0).
 *
 * Each preview section has its own prompt builder so `--regenerate <section>`
 * can re-run synthesis on just that section without disturbing the rest.
 *
 * The prompt builders return a string suitable for a single Anthropic
 * `messages.create({ messages: [{ role: 'user', content }] })` call. The
 * caller decides which model to use (PLANNER_MODEL for heavy synthesis,
 * QUALIFIER_MODEL for lightweight rewrites).
 */

import type { CompanyContext } from '../context-types.js'

export type SectionId =
  | 'framework'
  | 'voice'
  | 'icp'
  | 'positioning'
  | 'qualification_rules'
  | 'campaign_templates'
  | 'search_queries'

export interface SectionPromptInput {
  context: CompanyContext
  /** Optional raw scraped material (website / linkedin / docs / voice). */
  rawSources?: {
    website?: string | null
    linkedin?: string | null
    docs?: string | null
    voice?: string | null
  }
  /** User-supplied hint forwarded to the LLM (e.g. "drop agency segment"). */
  hint?: string
}

function rawBlock(input: SectionPromptInput): string {
  const r = input.rawSources ?? {}
  const parts: string[] = []
  if (r.website) parts.push(`<website>\n${r.website.slice(0, 8000)}\n</website>`)
  if (r.linkedin) parts.push(`<linkedin>\n${r.linkedin.slice(0, 4000)}\n</linkedin>`)
  if (r.docs) parts.push(`<docs>\n${r.docs.slice(0, 12000)}\n</docs>`)
  if (r.voice) parts.push(`<voice-samples>\n${r.voice.slice(0, 6000)}\n</voice-samples>`)
  return parts.join('\n\n')
}

function hintBlock(input: SectionPromptInput): string {
  return input.hint ? `\n\nUser hint: ${input.hint}\n` : ''
}

function contextBlock(input: SectionPromptInput): string {
  return `<company-context>\n${JSON.stringify(input.context, null, 2)}\n</company-context>`
}

export function buildFrameworkPrompt(input: SectionPromptInput): string {
  return [
    'Build a partial GTMFramework YAML from the captured company context and raw sources below. Only populate fields you have strong evidence for. Output strictly the YAML body — no fences, no commentary.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildVoicePrompt(input: SectionPromptInput): string {
  return [
    'Extract a tone-of-voice rulebook from the voice samples and any other context. Produce two markdown sections separated by `---END---`: section 1 is `tone-of-voice.md` (rules, do/don\'t list, signature phrases), section 2 is `examples.md` (3-5 short examples drawn from the samples). No code fences, no extra commentary.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildIcpPrompt(input: SectionPromptInput): string {
  return [
    'Derive ICP segments from the captured context. Output a YAML document with TWO top-level keys:',
    '1. `segments:` — a YAML list. Each segment has: id, name, description, priority (primary|secondary|exploratory), target_roles, target_industries, pain_points, disqualifiers.',
    '2. `audience_hangouts:` — an object with two arrays:',
    '   - `subreddits`: List 5-15 subreddits where this audience hangs out (lowercase, no `r/` prefix).',
    '   - `target_communities`: List 5-15 LinkedIn or Slack communities where this audience hangs out.',
    'No fences, no commentary.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildPositioningPrompt(input: SectionPromptInput): string {
  return [
    'Produce two markdown documents separated by `---BATTLECARD: <competitor-slug>---` repeating per competitor. Doc 1: a one-page positioning brief (`one-pager.md`) with category, value prop, differentiators, proof points. Then for each competitor in the company context, output a battlecard. Use only what is supported by the sources. No fences.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildQualificationPrompt(input: SectionPromptInput): string {
  return [
    'Generate qualification rules as a markdown document. Lead with one-line regex patterns (one per line) for headline matches, then a short bullet list of disqualifiers, then a section of soft signals to look for. Match the existing format YALC writes today.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildCampaignPrompt(input: SectionPromptInput): string {
  return [
    'Generate LinkedIn outreach templates as YAML. Required keys: connect_note (≤300 chars), dm1_template (use {{first_name}} and {{company}} placeholders), dm2_template (follow-up). No fences, no commentary.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function buildSearchQueriesPrompt(input: SectionPromptInput): string {
  return [
    'Produce 8-15 monitoring search queries (one per line) the user can plug into Reddit/LinkedIn/Google to surface buying signals. Strict plain text, no numbering, no commentary.',
    contextBlock(input),
    rawBlock(input),
    hintBlock(input),
  ]
    .filter(Boolean)
    .join('\n\n')
}

export const SECTION_PROMPT_BUILDERS: Record<SectionId, (input: SectionPromptInput) => string> = {
  framework: buildFrameworkPrompt,
  voice: buildVoicePrompt,
  icp: buildIcpPrompt,
  positioning: buildPositioningPrompt,
  qualification_rules: buildQualificationPrompt,
  campaign_templates: buildCampaignPrompt,
  search_queries: buildSearchQueriesPrompt,
}

/**
 * Single-shot text completion via Anthropic. Used by section regeneration —
 * synthesis stays simple (no tool-use) because the section bodies are
 * already free-form markdown / YAML / plain text.
 */
export async function runSectionPrompt(
  prompt: string,
  opts: { model?: string; maxTokens?: number } = {},
): Promise<string> {
  const { getAnthropicClient, PLANNER_MODEL } = await import('../../ai/client.js')
  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: opts.model ?? PLANNER_MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    messages: [{ role: 'user', content: prompt }],
  })
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('')
}
