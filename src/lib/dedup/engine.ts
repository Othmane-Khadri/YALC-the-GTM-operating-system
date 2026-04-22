/**
 * Dedup Engine
 *
 * Pluggable matchers for lead deduplication. Each matcher returns a
 * confidence score (0-100). The engine picks the highest match.
 *
 * Matchers:
 *   - Exact email (case-insensitive)
 *   - LinkedIn URL normalization
 *   - Fuzzy name+company (Dice coefficient, threshold 0.8)
 *   - Domain+title (same domain + similar title)
 */

import type { SuppressionEntry, DedupMatch, DedupResult, DedupConfig, LeadRecord } from './types'

// ─── Default Config ─────────────────────────────────────────────────────────

const DEFAULT_CONFIG: DedupConfig = {
  fuzzyNameThreshold: 0.8,
  domainTitleThreshold: 0.7,
  slackConfirmRange: [60, 80],
  slackTimeoutMs: 60 * 60 * 1000, // 1 hour
  enabledMatchers: ['email', 'linkedin', 'fuzzy_name_company', 'domain_title'],
}

// ─── LinkedIn URL Normalization ─────────────────────────────────────────────

export function normalizeLinkedInUrl(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url.trim())
    // Remove query params and hash
    let path = parsed.pathname
    // Strip trailing slashes
    path = path.replace(/\/+$/, '')
    // Normalize /pub/ to /in/
    path = path.replace(/^\/pub\//, '/in/')
    // Lowercase
    path = path.toLowerCase()
    return `https://www.linkedin.com${path}`
  } catch {
    // If not a valid URL, try to extract slug
    const slug = url.replace(/.*linkedin\.com\/(in|pub)\//, '').replace(/[/?#].*$/, '').toLowerCase()
    return slug ? `https://www.linkedin.com/in/${slug}` : ''
  }
}

// ─── Dice Coefficient ───────────────────────────────────────────────────────

function bigrams(str: string): Set<string> {
  const s = str.toLowerCase().trim()
  const bg = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    bg.add(s.substring(i, i + 2))
  }
  return bg
}

export function diceCoefficient(a: string, b: string): number {
  if (a.toLowerCase() === b.toLowerCase()) return 1
  if (!a || !b) return 0

  const aBigrams = bigrams(a)
  const bBigrams = bigrams(b)

  if (aBigrams.size === 0 && bBigrams.size === 0) return 1
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0

  let intersection = 0
  aBigrams.forEach(bg => {
    if (bBigrams.has(bg)) intersection++
  })

  return (2 * intersection) / (aBigrams.size + bBigrams.size)
}

// ─── Extract Domain from Email ──────────────────────────────────────────────

function extractDomain(email: string): string {
  if (!email) return ''
  const parts = email.toLowerCase().split('@')
  return parts.length === 2 ? parts[1] : ''
}

// ─── Matchers ───────────────────────────────────────────────────────────────

function matchExactEmail(
  lead: LeadRecord,
  entry: SuppressionEntry,
): DedupMatch | null {
  const leadEmail = (lead.email ?? '').toLowerCase().trim()
  const entryEmail = (entry.email ?? '').toLowerCase().trim()

  if (!leadEmail || !entryEmail) return null
  if (leadEmail === entryEmail) {
    return {
      matcher: 'email',
      confidence: 100,
      leadField: leadEmail,
      matchedField: entryEmail,
      matchedSource: entry.source,
      matchedId: entry.id,
    }
  }
  return null
}

function matchLinkedIn(
  lead: LeadRecord,
  entry: SuppressionEntry,
): DedupMatch | null {
  const leadUrl = normalizeLinkedInUrl(lead.linkedin_url ?? '')
  const entryUrl = normalizeLinkedInUrl(entry.linkedin_url ?? '')

  if (!leadUrl || !entryUrl) return null
  if (leadUrl === entryUrl) {
    return {
      matcher: 'linkedin',
      confidence: 95,
      leadField: lead.linkedin_url ?? '',
      matchedField: entry.linkedin_url ?? '',
      matchedSource: entry.source,
      matchedId: entry.id,
    }
  }
  return null
}

function matchFuzzyNameCompany(
  lead: LeadRecord,
  entry: SuppressionEntry,
  threshold: number,
): DedupMatch | null {
  const leadName = `${lead.first_name ?? ''} ${lead.last_name ?? ''} ${lead.company ?? ''}`.trim()
  const entryName = `${entry.first_name ?? ''} ${entry.last_name ?? ''} ${entry.company ?? ''}`.trim()

  if (!leadName || !entryName) return null

  const score = diceCoefficient(leadName, entryName)
  if (score >= threshold) {
    return {
      matcher: 'fuzzy_name_company',
      confidence: Math.round(score * 100),
      leadField: leadName,
      matchedField: entryName,
      matchedSource: entry.source,
      matchedId: entry.id,
    }
  }
  return null
}

function matchDomainTitle(
  lead: LeadRecord,
  entry: SuppressionEntry,
  threshold: number,
): DedupMatch | null {
  const leadDomain = extractDomain(lead.email ?? '')
  const entryDomain = extractDomain(entry.email ?? '')

  if (!leadDomain || !entryDomain) return null
  if (leadDomain !== entryDomain) return null

  // Same domain — check title similarity
  const leadTitle = (lead.headline ?? lead.title ?? '').toLowerCase().trim()
  const entryTitle = (entry.headline ?? '').toLowerCase().trim()

  if (!leadTitle || !entryTitle) return null

  const score = diceCoefficient(leadTitle, entryTitle)
  if (score >= threshold) {
    const confidence = Math.round(70 + score * 25) // 70-95 range
    return {
      matcher: 'domain_title',
      confidence,
      leadField: `${leadDomain} | ${leadTitle}`,
      matchedField: `${entryDomain} | ${entryTitle}`,
      matchedSource: entry.source,
      matchedId: entry.id,
    }
  }
  return null
}

// ─── Engine ─────────────────────────────────────────────────────────────────

export class DedupEngine {
  private config: DedupConfig

  constructor(config?: Partial<DedupConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Check a single lead against the suppression set.
   * Returns the best match (highest confidence) or null.
   */
  matchLead(lead: LeadRecord, suppressionSet: SuppressionEntry[]): DedupMatch | null {
    let best: DedupMatch | null = null

    for (const entry of suppressionSet) {
      const matches: (DedupMatch | null)[] = []

      if (this.config.enabledMatchers.includes('email')) {
        matches.push(matchExactEmail(lead, entry))
      }
      if (this.config.enabledMatchers.includes('linkedin')) {
        matches.push(matchLinkedIn(lead, entry))
      }
      if (this.config.enabledMatchers.includes('fuzzy_name_company')) {
        matches.push(matchFuzzyNameCompany(lead, entry, this.config.fuzzyNameThreshold))
      }
      if (this.config.enabledMatchers.includes('domain_title')) {
        matches.push(matchDomainTitle(lead, entry, this.config.domainTitleThreshold))
      }

      for (const m of matches) {
        if (m && (!best || m.confidence > best.confidence)) {
          best = m
        }
      }
    }

    return best
  }

  /**
   * Deduplicate a batch of leads against the suppression set.
   * Returns categorized results: unique, duplicates, and pending review.
   */
  dedup(leads: LeadRecord[], suppressionSet: SuppressionEntry[]): DedupResult {
    const result: DedupResult = {
      unique: [],
      duplicates: [],
      pendingReview: [],
    }

    const [lowThreshold, highThreshold] = this.config.slackConfirmRange

    for (const lead of leads) {
      const match = this.matchLead(lead, suppressionSet)

      if (!match) {
        result.unique.push(lead)
      } else if (match.confidence >= highThreshold) {
        result.duplicates.push({ lead, match })
      } else if (match.confidence >= lowThreshold) {
        result.pendingReview.push({ lead, match })
      } else {
        // Below the low threshold — treat as unique
        result.unique.push(lead)
      }
    }

    return result
  }

  getConfig(): DedupConfig {
    return { ...this.config }
  }
}
