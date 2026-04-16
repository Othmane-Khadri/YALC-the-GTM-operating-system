// ─── Auto-Personalization Skill ─────────────────────────────────────────────
// Takes a lead + message template → generates a hyper-personalized version using:
// 1. Lead's LinkedIn profile (Unipile)
// 2. Lead's company recent info (Firecrawl scrape)
// 3. Company/person enrichment (Crustdata — optional, on-demand)
// 4. Winning angles + pain points from intelligence store
// 5. Framework segments for matching

import type { Skill, SkillEvent, SkillContext } from '../types'
import { getAnthropicClient, PLANNER_MODEL } from '../../ai/client'
import { validateAndFix } from '../../outbound/validator'

interface PersonalizeInput {
  lead: {
    email?: string
    firstName?: string
    lastName?: string
    company?: string
    companyDomain?: string
    headline?: string
    linkedinUrl?: string
    title?: string
    [key: string]: unknown
  }
  template: string
  channel: 'email' | 'linkedin' | 'any'
  enrichWithCrustdata?: boolean   // pull additional signals from Crustdata
  linkedinAccountId?: string      // for fetching LinkedIn profile
  segmentId?: string              // for matching intelligence
  dryRun?: boolean
}

interface PersonalizationContext {
  linkedinProfile?: string
  companyInfo?: string
  crustdataEnrichment?: string
  intelligence?: string
}

export const personalizeSkill: Skill = {
  id: 'personalize',
  name: 'Auto-Personalize Message',
  version: '1.0.0',
  description:
    'Generate hyper-personalized outbound messages using LinkedIn profile, company scrape (Firecrawl), Crustdata enrichment, and intelligence store context. Works for email and LinkedIn.',
  category: 'content',

  inputSchema: {
    type: 'object',
    properties: {
      lead: { type: 'object', description: 'Lead with email, name, company, linkedinUrl' },
      template: { type: 'string', description: 'Message template to personalize' },
      channel: { type: 'string', enum: ['email', 'linkedin', 'any'] },
      enrichWithCrustdata: { type: 'boolean', description: 'Pull additional signals from Crustdata' },
      linkedinAccountId: { type: 'string', description: 'Unipile account ID for LinkedIn lookups' },
      segmentId: { type: 'string', description: 'ICP segment for intelligence matching' },
      dryRun: { type: 'boolean' },
    },
    required: ['lead', 'template', 'channel'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      personalizedMessage: { type: 'string' },
      sourcesUsed: { type: 'array', items: { type: 'string' } },
      confidenceScore: { type: 'number' },
    },
  },

  requiredCapabilities: [],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const opts = input as PersonalizeInput
    const { lead, template, channel } = opts
    const leadName = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email || 'Unknown'

    yield { type: 'progress', message: `Personalizing for ${leadName}...`, percent: 5 }

    const ctx: PersonalizationContext = {}
    const sourcesUsed: string[] = []

    // ── Source 1: LinkedIn Profile ──────────────────────────────────────
    if (lead.linkedinUrl && opts.linkedinAccountId) {
      try {
        const { unipileService } = await import('../../services/unipile')
        if (unipileService.isAvailable()) {
          const profile = await unipileService.getProfile(opts.linkedinAccountId, lead.linkedinUrl)
          const p = profile as Record<string, unknown>
          ctx.linkedinProfile = [
            `Name: ${p.first_name ?? ''} ${p.last_name ?? ''}`,
            `Headline: ${p.headline ?? p.occupation ?? ''}`,
            `Summary: ${String(p.summary ?? p.description ?? '').slice(0, 500)}`,
            `Location: ${p.location ?? ''}`,
            `Industry: ${p.industry ?? ''}`,
          ].join('\n')
          sourcesUsed.push('linkedin_profile')
          yield { type: 'progress', message: 'Fetched LinkedIn profile', percent: 20 }
        }
      } catch (err) {
        yield { type: 'progress', message: `LinkedIn profile lookup failed: ${err instanceof Error ? err.message : 'unknown'}`, percent: 20 }
      }
    }

    // ── Source 2: Company Website Scrape ────────────────────────────────
    const domain = lead.companyDomain ?? (lead.email ? lead.email.split('@')[1] : null)
    if (domain && domain !== 'gmail.com' && domain !== 'yahoo.com' && domain !== 'hotmail.com') {
      try {
        const { firecrawlService } = await import('../../services/firecrawl')
        if (firecrawlService.isAvailable()) {
          const markdown = await firecrawlService.scrape(`https://${domain}`)
          ctx.companyInfo = markdown.slice(0, 3000) // keep it tight for context window
          sourcesUsed.push('company_website')
          yield { type: 'progress', message: `Scraped ${domain}`, percent: 40 }
        }
      } catch (err) {
        yield { type: 'progress', message: `Company scrape failed: ${err instanceof Error ? err.message : 'unknown'}`, percent: 40 }
      }
    }

    // ── Source 3: Crustdata Enrichment (optional, costs credits — skipped in dry-run)
    if (opts.enrichWithCrustdata && domain && !opts.dryRun) {
      try {
        const { crustdataService } = await import('../../services/crustdata')
        if (crustdataService.isAvailable()) {
          const company = await crustdataService.enrichCompany(domain)
          ctx.crustdataEnrichment = [
            `Company: ${company.name}`,
            `Industry: ${company.industry}`,
            `Employees: ${company.employee_count}`,
            `Location: ${company.location}`,
            `Funding: ${company.funding_stage}`,
            `Founded: ${company.founded_year ?? 'unknown'}`,
            `Description: ${company.description.slice(0, 300)}`,
          ].join('\n')
          sourcesUsed.push('crustdata_enrichment')
          yield { type: 'progress', message: `Enriched via Crustdata: ${company.name} (${company.employee_count} employees, ${company.funding_stage})`, percent: 55 }
        }
      } catch (err) {
        yield { type: 'progress', message: `Crustdata enrichment failed: ${err instanceof Error ? err.message : 'unknown'}`, percent: 55 }
      }
    }

    // ── Source 4: Intelligence Store ────────────────────────────────────
    try {
      const { IntelligenceStore } = await import('../../intelligence/store')
      const store = new IntelligenceStore()
      const insights = await store.getForPrompt(opts.segmentId)
      if (insights.length > 0) {
        ctx.intelligence = insights
          .map((i) => `[${(i as { confidence?: string }).confidence ?? ''}] ${(i as { insight?: string }).insight ?? ''}`)
          .join('\n')
        sourcesUsed.push('intelligence_store')
        yield { type: 'progress', message: `Loaded ${insights.length} intelligence insights`, percent: 65 }
      }
    } catch {
      // intelligence is best-effort
    }

    // ── Generate Personalized Message ──────────────────────────────────
    yield { type: 'progress', message: 'Generating personalized message...', percent: 70 }

    const contextBlocks: string[] = []
    if (ctx.linkedinProfile) contextBlocks.push(`## LinkedIn Profile\n${ctx.linkedinProfile}`)
    if (ctx.companyInfo) contextBlocks.push(`## Company Website\n${ctx.companyInfo}`)
    if (ctx.crustdataEnrichment) contextBlocks.push(`## Company Data (Crustdata)\n${ctx.crustdataEnrichment}`)
    if (ctx.intelligence) contextBlocks.push(`## Winning Angles (from past campaigns)\n${ctx.intelligence}`)

    const leadContext = [
      lead.firstName && `First Name: ${lead.firstName}`,
      lead.lastName && `Last Name: ${lead.lastName}`,
      lead.company && `Company: ${lead.company}`,
      lead.headline && `Headline: ${lead.headline}`,
      lead.title && `Title: ${lead.title}`,
    ].filter(Boolean).join('\n')

    const systemPrompt = `You are a personalization engine for ${channel === 'email' ? 'cold emails' : channel === 'linkedin' ? 'LinkedIn messages' : 'outbound messages'}.

Your job: take the template below and make it hyper-specific to this prospect using the context provided. Replace generic parts with specific references. Keep the structure and CTA intact.

## Prospect
${leadContext}

${contextBlocks.join('\n\n')}

## Rules
- Keep the same length and tone as the template
- Replace generic claims with specific, verifiable references from the context
- If you found a trigger event (hiring, funding, product launch), lead with it
- If intelligence shows a winning angle, use it
- Never hallucinate — only reference facts from the provided context
- Keep all {{merge_fields}} intact (they get replaced at send time)
- ${channel === 'email' ? 'Subject line: 2-4 words, intrigue or clarity' : 'Max 300 characters for LinkedIn'}
- No em dashes, no exclamation marks, no buzzwords
- Output ONLY the personalized message, nothing else`

    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Personalize this template:\n\n${template}`,
      }],
    })

    let personalized = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    // Auto-fix against outbound rules
    const fixed = validateAndFix(personalized)
    if (fixed.fixes.length > 0) {
      personalized = fixed.text
      yield { type: 'progress', message: `Auto-fixed: ${fixed.fixes.join(', ')}`, percent: 90 }
    }

    // Confidence score based on sources used
    const confidenceScore = Math.min(100, sourcesUsed.length * 25)

    if (opts.dryRun) {
      yield {
        type: 'progress',
        message: [
          `[dry-run] Personalized message for ${leadName}:`,
          `[dry-run] Sources: ${sourcesUsed.join(', ') || 'none'}`,
          `[dry-run] Confidence: ${confidenceScore}/100`,
          `[dry-run] ---`,
          personalized,
          `[dry-run] ---`,
        ].join('\n'),
        percent: 100,
      }
    }

    yield { type: 'progress', message: `Personalized for ${leadName} (${sourcesUsed.length} sources, confidence: ${confidenceScore}/100)`, percent: 100 }
    yield {
      type: 'result',
      data: {
        personalizedMessage: personalized,
        sourcesUsed,
        confidenceScore,
        lead: { name: leadName, email: lead.email, company: lead.company },
      },
    }
  },
}
