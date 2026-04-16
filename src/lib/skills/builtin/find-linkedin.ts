/**
 * find-linkedin skill — resolves LinkedIn profile URLs from name + email.
 *
 * Strategy (web-search-first, dramatically cheaper):
 *
 * PRIMARY PATH — Firecrawl web search (~1 credit per 10 people):
 * 1. Extract company from email domain (FREE via Crustdata company_identify)
 * 2. Search Google via Firecrawl: "Jane Doe" "Acme" site:linkedin.com/in
 * 3. First linkedin.com/in/ result is almost always the right profile
 * 4. Validate URL + name match from search result title
 *
 * FALLBACK — Crustdata people_search_db (3 credits per company):
 * Used when: Firecrawl is unavailable, or web search returns no results
 * Groups leads by company domain → one search per company → fuzzy name match
 *
 * Cost comparison for 500 people from 500 companies:
 *   Web search: ~50 Firecrawl credits (1 per 10 results)
 *   Crustdata:  ~1,500 credits (3 per company)
 */

import type { Skill, SkillEvent, SkillContext } from '../types.js'

const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com',
  'hotmail.fr', 'outlook.com', 'live.com', 'aol.com', 'icloud.com',
  'me.com', 'mail.com', 'protonmail.com', 'proton.me', 'zoho.com',
  'gmx.com', 'gmx.de', 'web.de', 'yandex.com', 'qq.com', '163.com',
  'orange.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'wanadoo.fr',
])

interface LeadInput {
  email: string
  first_name?: string
  last_name?: string
  name?: string
  company?: string
}

interface ResolvedLead {
  email: string
  name: string
  company: string
  linkedin_url: string
  confidence: 'high' | 'medium' | 'low' | 'not_found'
  match_reason: string
  method: 'web_search' | 'crustdata_fallback' | 'none'
}

function extractDomain(email: string): string {
  const parts = email.split('@')
  return parts.length === 2 ? parts[1].toLowerCase() : ''
}

function buildName(lead: LeadInput): string {
  if (lead.name) return lead.name.trim()
  const parts = [lead.first_name, lead.last_name].filter(Boolean)
  return parts.join(' ').trim()
}

function normalizeForMatch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function nameMatch(searchName: string, candidateName: string): { match: boolean; score: number } {
  const a = normalizeForMatch(searchName)
  const b = normalizeForMatch(candidateName)

  if (a === b) return { match: true, score: 1.0 }

  const aParts = a.split(/\s+/)
  const bParts = b.split(/\s+/)
  const allPartsMatch = aParts.every(part => bParts.some(bp => bp.includes(part) || part.includes(bp)))
  if (allPartsMatch && aParts.length >= 2) return { match: true, score: 0.9 }

  if (aParts.length >= 2 && bParts.length >= 2) {
    const firstMatch = aParts[0] === bParts[0]
    const lastMatch = aParts[aParts.length - 1] === bParts[bParts.length - 1]
    if (firstMatch && lastMatch) return { match: true, score: 0.85 }
  }

  return { match: false, score: 0 }
}

/** Extract a linkedin.com/in/ URL from search results. */
function extractLinkedInUrl(results: Array<{ url: string; title: string }>): { url: string; title: string } | null {
  for (const r of results) {
    const url = r.url.toLowerCase()
    if (url.includes('linkedin.com/in/')) {
      return r
    }
  }
  return null
}

/** Check if the search result title contains the person's name. */
function titleContainsName(title: string, name: string): boolean {
  const norm = normalizeForMatch(title)
  const nameParts = normalizeForMatch(name).split(/\s+/)
  // At least first and last name should appear in title
  if (nameParts.length >= 2) {
    return nameParts[0].length > 1 && norm.includes(nameParts[0]) &&
           nameParts[nameParts.length - 1].length > 1 && norm.includes(nameParts[nameParts.length - 1])
  }
  return nameParts.every(p => p.length > 1 && norm.includes(p))
}

function companyFromDomain(domain: string): string {
  return domain
    .replace(/\.(com|io|co|net|org|ai|dev|app|tech|xyz|us|uk|de|fr|es|it|nl|be|ch|at|ca|au)$/i, '')
    .replace(/\./g, ' ')
}

export const findLinkedinSkill: Skill = {
  id: 'find-linkedin',
  name: 'Find LinkedIn Profiles',
  version: '2.0.0',
  description:
    'Resolve LinkedIn profile URLs from a list of names + emails. Uses web search as the primary method (cheap), with Crustdata people search as fallback.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      leads: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            name: { type: 'string' },
            company: { type: 'string' },
          },
          required: ['email'],
        },
        description: 'Leads with email and name. Company is optional — extracted from email domain if missing.',
      },
      skipFallback: {
        type: 'boolean',
        description: 'Skip Crustdata fallback for unresolved leads (web search only)',
      },
    },
    required: ['leads'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      resolved: { type: 'array', items: { type: 'object' } },
      stats: { type: 'object' },
    },
  },
  requiredCapabilities: ['search'],

  estimatedCost(_input: unknown) {
    // Web search path is essentially free (Firecrawl credits, not Crustdata).
    // Only the fallback uses Crustdata credits.
    return 0
  },

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const { leads, skipFallback = false } = input as { leads: LeadInput[]; skipFallback?: boolean }

    if (leads.length === 0) {
      yield { type: 'error', message: 'No leads provided.' }
      return
    }

    // Detect available providers
    const { firecrawlService } = await import('../../services/firecrawl.js')
    const hasFirecrawl = firecrawlService.isAvailable()

    let hasCrustdata = false
    let crustdataService: Awaited<typeof import('../../services/crustdata.js')>['crustdataService'] | null = null
    try {
      const mod = await import('../../services/crustdata.js')
      crustdataService = mod.crustdataService
      hasCrustdata = crustdataService.isAvailable()
    } catch { /* not available */ }

    if (!hasFirecrawl && !hasCrustdata) {
      yield { type: 'error', message: 'Neither FIRECRAWL_API_KEY nor CRUSTDATA_API_KEY is set. Need at least one to search.' }
      return
    }

    yield {
      type: 'progress',
      message: `Processing ${leads.length} leads. Strategy: ${hasFirecrawl ? 'web search' : 'Crustdata search'}${hasFirecrawl && hasCrustdata && !skipFallback ? ' + Crustdata fallback' : ''}.`,
      percent: 5,
    }

    // Step 1: Resolve company names from email domains (FREE)
    yield { type: 'progress', message: 'Identifying companies from email domains...', percent: 10 }

    const domainToCompany = new Map<string, string>()
    const uniqueDomains = new Set(
      leads.map(l => extractDomain(l.email)).filter(d => d && !PERSONAL_DOMAINS.has(d)),
    )

    if (hasCrustdata) {
      for (const domain of uniqueDomains) {
        try {
          const res = await fetch(`https://api.crustdata.com/screener/company/identify?domain=${encodeURIComponent(domain)}`, {
            headers: {
              'Authorization': `Token ${process.env.CRUSTDATA_API_KEY}`,
              'Content-Type': 'application/json',
            },
          })
          if (res.ok) {
            const data = await res.json() as { name?: string; company_name?: string }
            const name = data.name ?? data.company_name
            if (name) domainToCompany.set(domain, name)
          }
        } catch { /* skip — use domain as fallback */ }
      }
    }

    yield {
      type: 'progress',
      message: `Identified ${domainToCompany.size}/${uniqueDomains.size} companies. Starting lookups...`,
      percent: 15,
    }

    // Step 2: Web search for each lead
    const resolved: ResolvedLead[] = []
    const unresolvedForFallback: Array<{ lead: LeadInput; company: string }> = []
    let processed = 0

    for (const lead of leads) {
      const name = buildName(lead)
      const domain = extractDomain(lead.email)
      const company = lead.company ?? domainToCompany.get(domain) ?? (PERSONAL_DOMAINS.has(domain) ? '' : companyFromDomain(domain))

      if (!name) {
        resolved.push({
          email: lead.email, name: '', company, linkedin_url: '',
          confidence: 'not_found', match_reason: 'No name provided', method: 'none',
        })
        processed++
        continue
      }

      // Try web search first
      if (hasFirecrawl) {
        try {
          const query = company
            ? `"${name}" "${company}" site:linkedin.com/in`
            : `"${name}" site:linkedin.com/in`

          const results = await firecrawlService.search(query, 3)
          const linkedinResult = extractLinkedInUrl(results)

          if (linkedinResult) {
            const titleMatch = titleContainsName(linkedinResult.title, name)
            const confidence = titleMatch ? 'high' : 'medium'
            resolved.push({
              email: lead.email, name, company,
              linkedin_url: linkedinResult.url,
              confidence,
              match_reason: titleMatch
                ? `Web search: "${linkedinResult.title}" — name confirmed in title`
                : `Web search: "${linkedinResult.title}" — URL matched but name not confirmed in title`,
              method: 'web_search',
            })
            processed++
            if (processed % 10 === 0) {
              yield {
                type: 'progress',
                message: `Processed ${processed}/${leads.length} leads...`,
                percent: 15 + (processed / leads.length) * 70,
              }
            }
            continue
          }
        } catch {
          // Web search failed for this lead — fall through to fallback
        }
      }

      // Web search didn't find it — queue for fallback
      if (!skipFallback && hasCrustdata) {
        unresolvedForFallback.push({ lead, company })
      } else {
        resolved.push({
          email: lead.email, name, company, linkedin_url: '',
          confidence: 'not_found',
          match_reason: hasFirecrawl ? 'Web search returned no LinkedIn results' : 'Firecrawl not available',
          method: 'none',
        })
      }

      processed++
      if (processed % 10 === 0) {
        yield {
          type: 'progress',
          message: `Processed ${processed}/${leads.length} leads...`,
          percent: 15 + (processed / leads.length) * 70,
        }
      }
    }

    // Step 3: Crustdata fallback for unresolved leads
    if (unresolvedForFallback.length > 0 && crustdataService) {
      yield {
        type: 'progress',
        message: `Web search resolved ${resolved.filter(r => r.method === 'web_search').length}/${leads.length}. Running Crustdata fallback for ${unresolvedForFallback.length} remaining...`,
        percent: 85,
      }

      // Group by company for efficient batch search
      const companyGroups = new Map<string, Array<{ lead: LeadInput; company: string }>>()
      for (const item of unresolvedForFallback) {
        const key = item.company || '__unknown__'
        const existing = companyGroups.get(key) ?? []
        existing.push(item)
        companyGroups.set(key, existing)
      }

      for (const [company, items] of companyGroups) {
        if (company === '__unknown__') {
          for (const { lead } of items) {
            resolved.push({
              email: lead.email, name: buildName(lead), company: '',
              linkedin_url: '', confidence: 'not_found',
              match_reason: 'No company identified — cannot search Crustdata',
              method: 'none',
            })
          }
          continue
        }

        try {
          const tracked = await crustdataService.searchPeople({
            companyNames: [company],
            limit: Math.min(items.length * 5, 100),
          })
          const candidates = tracked.result.people

          for (const { lead } of items) {
            const name = buildName(lead)
            let bestMatch: { person: typeof candidates[0]; score: number } | null = null
            for (const candidate of candidates) {
              const result = nameMatch(name, candidate.name)
              if (result.match && (!bestMatch || result.score > bestMatch.score)) {
                bestMatch = { person: candidate, score: result.score }
              }
            }

            if (bestMatch && bestMatch.person.linkedin_url) {
              resolved.push({
                email: lead.email, name, company,
                linkedin_url: bestMatch.person.linkedin_url,
                confidence: bestMatch.score >= 0.9 ? 'medium' : 'low', // Downgraded vs web search
                match_reason: `Crustdata fallback: matched "${bestMatch.person.name}" (score: ${bestMatch.score.toFixed(2)})`,
                method: 'crustdata_fallback',
              })
            } else {
              resolved.push({
                email: lead.email, name, company, linkedin_url: '',
                confidence: 'not_found',
                match_reason: `Not found in web search or Crustdata (${candidates.length} candidates at ${company})`,
                method: 'none',
              })
            }
          }
        } catch (err) {
          for (const { lead } of items) {
            resolved.push({
              email: lead.email, name: buildName(lead), company,
              linkedin_url: '', confidence: 'not_found',
              match_reason: `Crustdata fallback failed: ${err instanceof Error ? err.message : String(err)}`,
              method: 'none',
            })
          }
        }
      }
    }

    // Step 4: Stats
    const webFound = resolved.filter(r => r.method === 'web_search').length
    const crustdataFound = resolved.filter(r => r.method === 'crustdata_fallback').length
    const stats = {
      total: leads.length,
      found: resolved.filter(r => r.confidence !== 'not_found').length,
      high_confidence: resolved.filter(r => r.confidence === 'high').length,
      medium_confidence: resolved.filter(r => r.confidence === 'medium').length,
      low_confidence: resolved.filter(r => r.confidence === 'low').length,
      not_found: resolved.filter(r => r.confidence === 'not_found').length,
      method_web_search: webFound,
      method_crustdata_fallback: crustdataFound,
    }

    yield { type: 'result', data: { resolved, stats } }

    yield {
      type: 'progress',
      message: `Done. ${stats.found}/${stats.total} LinkedIn profiles found (${webFound} via web search, ${crustdataFound} via Crustdata fallback). ${stats.high_confidence} high, ${stats.medium_confidence} medium, ${stats.low_confidence} low confidence.`,
      percent: 100,
    }
  },
}
