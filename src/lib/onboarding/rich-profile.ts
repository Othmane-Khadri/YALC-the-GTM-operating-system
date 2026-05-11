/**
 * Rich profile synthesis (A4).
 *
 * Single tool-use call against Claude that turns the captured raw sources
 * (website scrape, LinkedIn excerpt, docs, ICP free-text) into a structured
 * profile mirroring `profile-builder.ts`'s `build_framework` schema:
 *
 *   - competitors[] with weaknesses + battlecardNotes
 *   - segments[] with painPoints, buyingTriggers, keyDecisionMakers,
 *     disqualifiers, targetRoles, targetIndustries
 *   - signals.{buyingIntentSignals, monitoringKeywords, triggerEvents}
 *
 * Used by `runFlagCapture()` so `_preview/company_context.yaml` lands rich
 * on the FIRST pass — no need to wait for a separate `framework:derive`
 * run for the SPA review surface to show competitor weaknesses or buying
 * triggers.
 *
 * This module deliberately does NOT save a framework — it is a pure
 * synthesis helper. Persistence + framework merging stays in
 * `framework/derive.ts` and `profile-builder.ts`.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, QUALIFIER_MODEL } from '../ai/client.js'
import type {
  CompanyContextCompetitorDetail,
  CompanyContextSegmentDetail,
  CompanyContextSignals,
} from '../framework/context-types.js'

export interface RichProfileInputs {
  /** Optional company name from the user (CLI flag). */
  companyName?: string
  /** URL the user provided so the model can anchor names to a domain. */
  website?: string
  /** Raw scraped website markdown / HTML. */
  websiteContent?: string | null
  /** Raw LinkedIn profile content. */
  linkedinContent?: string | null
  /** Raw docs blob (concatenated markdown / text). */
  docsContent?: string | null
  /** Free-form ICP one-liner the user supplied via `--icp-summary`. */
  icpSummary?: string
}

export interface RichProfileResult {
  competitors: CompanyContextCompetitorDetail[]
  segments: CompanyContextSegmentDetail[]
  signals: CompanyContextSignals
  /**
   * Optional company-level fields the model produced. These are folded into
   * `company_context.yaml#company` only when the existing field is empty so
   * user-supplied values always win.
   */
  company?: {
    name?: string
    industry?: string
    description?: string
    stage?: string
    teamSize?: string
  }
  /**
   * Top-level positioning value prop / differentiators when the model
   * inferred them. Used to seed downstream synthesis prompts.
   */
  positioning?: {
    valueProp?: string
    category?: string
    differentiators?: string[]
    proofPoints?: string[]
  }
}

/**
 * Tool-use schema. Mirrors `profile-builder.ts#build_framework` so the two
 * paths stay in lockstep — `profile-builder.ts` now consumes this exported
 * tool definition instead of redeclaring it.
 */
export const RICH_PROFILE_TOOL: Anthropic.Tool = {
  name: 'build_framework',
  description:
    'Build a complete GTM framework profile from the provided business context. Populate every field you can ground in the source material — competitor weaknesses, segment buying triggers, decision makers, monitoring keywords. If you do not have evidence for a field, leave it empty rather than fabricating.',
  input_schema: {
    type: 'object',
    properties: {
      company: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          website: { type: 'string' },
          linkedinUrl: { type: 'string' },
          industry: { type: 'string' },
          subIndustry: { type: 'string' },
          stage: {
            type: 'string',
            enum: ['pre-seed', 'seed', 'series-a', 'series-b', 'growth', 'enterprise'],
          },
          description: { type: 'string' },
          teamSize: { type: 'string' },
          foundedYear: { type: 'number' },
          headquarters: { type: 'string' },
        },
        required: ['name', 'website', 'industry', 'description'],
      },
      positioning: {
        type: 'object',
        properties: {
          valueProp: { type: 'string' },
          tagline: { type: 'string' },
          category: { type: 'string' },
          differentiators: { type: 'array', items: { type: 'string' } },
          proofPoints: { type: 'array', items: { type: 'string' } },
          competitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                website: { type: 'string' },
                positioning: { type: 'string' },
                weaknesses: { type: 'array', items: { type: 'string' } },
                battlecardNotes: { type: 'string' },
              },
            },
          },
        },
        required: ['valueProp', 'category'],
      },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            priority: {
              type: 'string',
              enum: ['primary', 'secondary', 'exploratory'],
            },
            targetRoles: { type: 'array', items: { type: 'string' } },
            targetCompanySizes: { type: 'array', items: { type: 'string' } },
            targetIndustries: { type: 'array', items: { type: 'string' } },
            keyDecisionMakers: { type: 'array', items: { type: 'string' } },
            painPoints: { type: 'array', items: { type: 'string' } },
            buyingTriggers: { type: 'array', items: { type: 'string' } },
            disqualifiers: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'name', 'priority'],
        },
      },
      signals: {
        type: 'object',
        properties: {
          buyingIntentSignals: { type: 'array', items: { type: 'string' } },
          monitoringKeywords: { type: 'array', items: { type: 'string' } },
          triggerEvents: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    required: ['company', 'positioning', 'segments', 'signals'],
  },
}

/**
 * Build the user message content for the rich-profile call. Trims each
 * source so we stay inside the model's prompt window even when the user
 * supplied multiple long docs. Order matters — website first since it
 * usually carries the strongest brand + product signal.
 */
export function buildRichProfilePrompt(inputs: RichProfileInputs): string {
  const parts: string[] = []
  if (inputs.companyName) parts.push(`## Company name (user-provided)\n${inputs.companyName}`)
  if (inputs.website) parts.push(`## Website URL\n${inputs.website}`)
  if (inputs.websiteContent) {
    parts.push(`## Website Content\n${inputs.websiteContent.slice(0, 10000)}`)
  }
  if (inputs.linkedinContent) {
    parts.push(`## LinkedIn Profile\n${inputs.linkedinContent.slice(0, 4000)}`)
  }
  if (inputs.docsContent) {
    parts.push(`## Docs\n${inputs.docsContent.slice(0, 12000)}`)
  }
  if (inputs.icpSummary) {
    parts.push(`## ICP Summary (user-provided)\n${inputs.icpSummary}`)
  }
  const body = parts.join('\n\n')
  return `Based on the following business information, build a complete GTM framework profile. Use the build_framework tool. Populate competitor weaknesses, segment buying triggers, segment decision makers, and monitoring signals whenever the source material supports them.\n\n${body}`
}

/**
 * Whether we have enough material for a rich-profile call to make sense.
 * The thresholds mirror `validateCaptureForSynthesis()` — we don't want to
 * burn tokens on a 30-character scrape.
 */
export function hasEnoughForRichProfile(inputs: RichProfileInputs): boolean {
  const w = inputs.websiteContent?.length ?? 0
  const l = inputs.linkedinContent?.length ?? 0
  const d = inputs.docsContent?.length ?? 0
  const i = inputs.icpSummary?.length ?? 0
  return w >= 500 || l >= 200 || d >= 200 || i >= 80
}

/**
 * Single tool-use call → parsed result. Returns `null` when the tool block
 * could not be extracted (e.g. the model emitted text only) so the caller
 * can fall back to the thin context without hard-failing the capture.
 */
export async function buildRichCompanyProfile(
  inputs: RichProfileInputs,
): Promise<RichProfileResult | null> {
  if (!hasEnoughForRichProfile(inputs)) return null

  const client = getAnthropicClient()
  const response = await client.messages.create({
    model: QUALIFIER_MODEL,
    max_tokens: 4096,
    tools: [RICH_PROFILE_TOOL],
    tool_choice: { type: 'tool', name: 'build_framework' },
    messages: [
      {
        role: 'user',
        content: buildRichProfilePrompt(inputs),
      },
    ],
  })

  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'build_framework') {
      return normalizeRichProfile(block.input)
    }
  }
  return null
}

/**
 * Coerce the tool-use input (which is loosely-typed `unknown` from the SDK)
 * into the strict `RichProfileResult` shape the rest of the codebase
 * consumes. Everything is defensive — missing fields default to empty
 * arrays / empty strings so callers never have to guard against undefined
 * properties on the result.
 */
export function normalizeRichProfile(raw: unknown): RichProfileResult {
  const root = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {})
  const companyRaw = (root.company ?? {}) as Record<string, unknown>
  const positioningRaw = (root.positioning ?? {}) as Record<string, unknown>
  const segmentsRaw = Array.isArray(root.segments) ? (root.segments as unknown[]) : []
  const signalsRaw = (root.signals ?? {}) as Record<string, unknown>
  const competitorsRaw = Array.isArray(positioningRaw.competitors)
    ? (positioningRaw.competitors as unknown[])
    : []

  const stringArr = (xs: unknown): string[] =>
    Array.isArray(xs) ? xs.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []
  const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '')

  const competitors: CompanyContextCompetitorDetail[] = competitorsRaw.map((c) => {
    const o = (c && typeof c === 'object' ? c : {}) as Record<string, unknown>
    return {
      name: str(o.name),
      website: str(o.website),
      positioning: str(o.positioning),
      weaknesses: stringArr(o.weaknesses),
      battlecardNotes: str(o.battlecardNotes),
    }
  }).filter((c) => c.name.length > 0)

  const segments: CompanyContextSegmentDetail[] = segmentsRaw.map((s, i) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    const priorityStr = str(o.priority)
    const priority: 'primary' | 'secondary' | 'exploratory' =
      priorityStr === 'primary' || priorityStr === 'exploratory'
        ? priorityStr
        : 'secondary'
    return {
      id: str(o.id) || `segment-${i + 1}`,
      name: str(o.name),
      description: str(o.description),
      priority,
      targetRoles: stringArr(o.targetRoles),
      targetCompanySizes: stringArr(o.targetCompanySizes),
      targetIndustries: stringArr(o.targetIndustries),
      keyDecisionMakers: stringArr(o.keyDecisionMakers),
      painPoints: stringArr(o.painPoints),
      buyingTriggers: stringArr(o.buyingTriggers),
      disqualifiers: stringArr(o.disqualifiers),
    }
  }).filter((s) => s.name.length > 0)

  const signals: CompanyContextSignals = {
    buyingIntentSignals: stringArr(signalsRaw.buyingIntentSignals),
    monitoringKeywords: stringArr(signalsRaw.monitoringKeywords),
    triggerEvents: stringArr(signalsRaw.triggerEvents),
  }

  const out: RichProfileResult = { competitors, segments, signals }

  // Optional company-level + positioning fields. Only include keys the
  // model actually populated so callers can use idiomatic
  // `if (rich.company?.name)` checks.
  const company: NonNullable<RichProfileResult['company']> = {}
  if (str(companyRaw.name)) company.name = str(companyRaw.name)
  if (str(companyRaw.industry)) company.industry = str(companyRaw.industry)
  if (str(companyRaw.description)) company.description = str(companyRaw.description)
  if (str(companyRaw.stage)) company.stage = str(companyRaw.stage)
  if (str(companyRaw.teamSize)) company.teamSize = str(companyRaw.teamSize)
  if (Object.keys(company).length > 0) out.company = company

  const positioning: NonNullable<RichProfileResult['positioning']> = {}
  if (str(positioningRaw.valueProp)) positioning.valueProp = str(positioningRaw.valueProp)
  if (str(positioningRaw.category)) positioning.category = str(positioningRaw.category)
  if (Array.isArray(positioningRaw.differentiators) && positioningRaw.differentiators.length > 0) {
    positioning.differentiators = stringArr(positioningRaw.differentiators)
  }
  if (Array.isArray(positioningRaw.proofPoints) && positioningRaw.proofPoints.length > 0) {
    positioning.proofPoints = stringArr(positioningRaw.proofPoints)
  }
  if (Object.keys(positioning).length > 0) out.positioning = positioning

  return out
}
