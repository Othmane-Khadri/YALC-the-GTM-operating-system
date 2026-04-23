// ─── Competitive Intelligence Skill ─────────────────────────────────────────
// Input: competitor name or URL
// Process: Firecrawl scrape → Crustdata enrich → Claude analyze → update framework
// Output: structured competitor profile

import type { Skill, SkillEvent, SkillContext } from '../types'
import { getAnthropicClient, PLANNER_MODEL } from '../../ai/client'
import { getWebFetchProvider } from '../../env/claude-code'

interface CompetitiveIntelInput {
  competitor: string  // URL or company name
  enrichWithCrustdata?: boolean
  dryRun?: boolean
}

interface CompetitorProfile {
  name: string
  website: string
  positioning: string
  strengths: string[]
  weaknesses: string[]
  icp: string
  pricing: string
  differentiators: string[]
  recentMoves: string[]
  threatLevel: 'low' | 'medium' | 'high'
  counterPositioning: string
}

export const competitiveIntelSkill: Skill = {
  id: 'competitive-intel',
  name: 'Competitive Intelligence',
  version: '1.0.0',
  description:
    'Research a competitor: scrape their website, enrich via Crustdata, analyze with Claude. Outputs a structured competitor profile with counter-positioning.',
  category: 'research',

  inputSchema: {
    type: 'object',
    properties: {
      competitor: { type: 'string', description: 'Competitor URL or company name' },
      enrichWithCrustdata: { type: 'boolean', description: 'Pull company data from Crustdata' },
      dryRun: { type: 'boolean' },
    },
    required: ['competitor'],
  },

  outputSchema: {
    type: 'object',
    properties: {
      profile: { type: 'object' },
    },
  },

  requiredCapabilities: [],

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const opts = input as CompetitiveIntelInput
    const competitor = opts.competitor

    // Determine if input is URL or name
    const isUrl = competitor.startsWith('http') || competitor.includes('.')
    const url = isUrl ? (competitor.startsWith('http') ? competitor : `https://${competitor}`) : null
    let domain: string | null = null
    if (url) {
      try { domain = new URL(url).hostname.replace('www.', '') }
      catch { domain = null }
    }

    yield { type: 'progress', message: `Researching competitor: ${competitor}...`, percent: 5 }

    // ── Scrape website ─────────────────────────────────────────────────
    let websiteContent = ''
    if (url) {
      try {
        const { firecrawlService } = await import('../../services/firecrawl')
        if (firecrawlService.isAvailable()) {
          websiteContent = await firecrawlService.scrape(url)
          websiteContent = websiteContent.slice(0, 8000)
          yield { type: 'progress', message: `Scraped ${url}`, percent: 25 }
        }
      } catch (err) {
        yield { type: 'progress', message: `Scrape failed: ${err instanceof Error ? err.message : 'unknown'}`, percent: 25 }
      }
    }

    // If no URL, try Firecrawl search
    if (!websiteContent) {
      try {
        const { firecrawlService } = await import('../../services/firecrawl')
        if (firecrawlService.isAvailable()) {
          const results = await firecrawlService.search(`${competitor} company`, 3)
          websiteContent = results.map(r => `# ${r.title}\n${r.content}`).join('\n\n').slice(0, 8000)
          yield { type: 'progress', message: `Found ${results.length} search results for ${competitor}`, percent: 25 }
        }
      } catch {
        // search is best-effort
      }
    }

    // ── Crustdata enrichment ───────────────────────────────────────────
    let crustdataInfo = ''
    if (opts.enrichWithCrustdata && domain) {
      try {
        const { crustdataService } = await import('../../services/crustdata')
        if (crustdataService.isAvailable()) {
          const company = await crustdataService.enrichCompany(domain)
          crustdataInfo = [
            `Company: ${company.name}`,
            `Industry: ${company.industry}`,
            `Employees: ${company.employee_count}`,
            `Location: ${company.location}`,
            `Funding: ${company.funding_stage}`,
            `Founded: ${company.founded_year ?? 'unknown'}`,
            `Description: ${company.description}`,
          ].join('\n')
          yield { type: 'progress', message: `Crustdata: ${company.name}, ${company.employee_count} employees, ${company.funding_stage}`, percent: 45 }
        }
      } catch (err) {
        yield { type: 'progress', message: `Crustdata enrichment failed: ${err instanceof Error ? err.message : 'unknown'}`, percent: 45 }
      }
    }

    // ── Claude analysis ────────────────────────────────────────────────
    yield { type: 'progress', message: 'Analyzing with Claude...', percent: 55 }

    const contextBlocks = []
    if (websiteContent) contextBlocks.push(`## Website Content\n${websiteContent}`)
    if (crustdataInfo) contextBlocks.push(`## Company Data (Crustdata)\n${crustdataInfo}`)

    if (contextBlocks.length === 0) {
      const provider = getWebFetchProvider()
      if (provider === 'claude-code' && url) {
        yield {
          type: 'error',
          message:
            `No web data fetched for "${competitor}". Running inside Claude Code without Firecrawl — ` +
            `ask your parent CC session to fetch it for you:\n` +
            `  "Use the WebFetch tool on ${url}, save the markdown to data/competitor.md, ` +
            `then re-run \`yalc-gtm competitive-intel --competitor ${competitor}\` after I add Firecrawl, ` +
            `or feed the file into the analysis directly."\n` +
            `Or add FIRECRAWL_API_KEY to .env.local and re-run.`,
        }
        return
      }
      yield { type: 'error', message: `No data found for "${competitor}". Provide a URL or check your API keys.` }
      return
    }

    const anthropic = getAnthropicClient()
    const response = await anthropic.messages.create({
      model: PLANNER_MODEL,
      max_tokens: 2048,
      system: `You are a competitive intelligence analyst. Analyze the provided data about a competitor and produce a structured profile. Return ONLY valid JSON, no other text.`,
      messages: [{
        role: 'user',
        content: `Analyze this competitor and return a JSON profile:

${contextBlocks.join('\n\n')}

Return JSON:
{
  "name": "company name",
  "website": "domain",
  "positioning": "how they position themselves in one sentence",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "weaknesses": ["weakness 1", "weakness 2"],
  "icp": "who they sell to",
  "pricing": "pricing model/range if visible, otherwise 'not public'",
  "differentiators": ["what makes them unique 1", "what makes them unique 2"],
  "recentMoves": ["recent news, launches, or changes"],
  "threatLevel": "low | medium | high",
  "counterPositioning": "how to position against them in 1-2 sentences"
}`,
      }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      yield { type: 'error', message: 'Failed to parse competitor profile from Claude' }
      return
    }

    let profile: CompetitorProfile
    try {
      profile = JSON.parse(jsonMatch[0]) as CompetitorProfile
    } catch (err) {
      yield { type: 'error', message: `Failed to parse competitor profile JSON: ${err instanceof Error ? err.message : err}` }
      return
    }

    // ── Output ─────────────────────────────────────────────────────────
    console.log(`\n── Competitor Profile: ${profile.name} ──`)
    console.log(`  Website:       ${profile.website}`)
    console.log(`  Positioning:   ${profile.positioning}`)
    console.log(`  ICP:           ${profile.icp}`)
    console.log(`  Pricing:       ${profile.pricing}`)
    console.log(`  Threat Level:  ${profile.threatLevel}`)
    console.log(`  Strengths:     ${profile.strengths.join(', ')}`)
    console.log(`  Weaknesses:    ${profile.weaknesses.join(', ')}`)
    console.log(`  Differentiators: ${profile.differentiators.join(', ')}`)
    console.log(`  Recent Moves:  ${profile.recentMoves.join(', ')}`)
    console.log(`  Counter-positioning: ${profile.counterPositioning}`)

    yield { type: 'progress', message: `Competitor profile complete: ${profile.name} (${profile.threatLevel} threat)`, percent: 100 }
    yield { type: 'result', data: { profile } }
  },
}
