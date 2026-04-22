/**
 * Field Mapper
 *
 * Auto-maps GTM-OS canonical field names to CRM field names using
 * fuzzy matching. Produces a FieldMapping that can be reviewed by
 * the user and saved to YAML.
 */

import type { FieldMapping, CRMFieldInfo } from './types'

// ─── GTM-OS Canonical Fields ────────────────────────────────────────────────

export const GTM_CANONICAL_FIELDS = [
  { key: 'email', aliases: ['email_address', 'e_mail', 'mail', 'contact_email', 'work_email'] },
  { key: 'first_name', aliases: ['firstname', 'first', 'given_name', 'fname'] },
  { key: 'last_name', aliases: ['lastname', 'last', 'family_name', 'surname', 'lname'] },
  { key: 'full_name', aliases: ['name', 'contact_name', 'display_name'] },
  { key: 'company', aliases: ['company_name', 'organization', 'org', 'account', 'account_name'] },
  { key: 'title', aliases: ['job_title', 'position', 'role', 'jobtitle'] },
  { key: 'phone', aliases: ['phone_number', 'telephone', 'mobile', 'cell', 'work_phone'] },
  { key: 'linkedin_url', aliases: ['linkedin', 'linkedin_profile', 'li_url', 'linkedin_profile_url'] },
  { key: 'website', aliases: ['url', 'company_url', 'domain', 'company_website', 'web'] },
  { key: 'industry', aliases: ['sector', 'vertical'] },
  { key: 'city', aliases: ['location_city'] },
  { key: 'state', aliases: ['region', 'province', 'location_state'] },
  { key: 'country', aliases: ['location_country', 'nation'] },
  { key: 'company_size', aliases: ['headcount', 'employees', 'employee_count', 'num_employees', 'company_headcount'] },
  { key: 'revenue', aliases: ['annual_revenue', 'arr', 'company_revenue'] },
  { key: 'source', aliases: ['lead_source', 'origin', 'channel'] },
  { key: 'status', aliases: ['lead_status', 'lifecycle_stage', 'stage'] },
  { key: 'score', aliases: ['lead_score', 'qualification_score', 'rating'] },
  { key: 'notes', aliases: ['description', 'comments', 'memo'] },
  { key: 'created_at', aliases: ['created', 'create_date', 'created_date'] },
  { key: 'updated_at', aliases: ['updated', 'last_modified', 'modified_date', 'last_activity'] },
] as const

// ─── Normalization ──────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
}

// ─── Similarity ─────────────────────────────────────────────────────────────

/**
 * Compute similarity between two normalized strings.
 * Uses a combination of exact match, prefix match, and Dice coefficient.
 */
export function fieldSimilarity(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)

  // Exact match
  if (na === nb) return 1.0

  // One contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.85

  // Dice coefficient on bigrams
  const bigramsA = bigrams(na)
  const bigramsB = bigrams(nb)
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0

  let intersection = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size)
}

function bigrams(s: string): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2))
  }
  return result
}

// ─── Auto Mapper ────────────────────────────────────────────────────────────

export interface AutoMapResult {
  mapping: FieldMapping
  /** Fields that were auto-mapped with high confidence */
  confident: Array<{ gtm: string; crm: string; score: number }>
  /** Fields that had a weak match — user should review */
  uncertain: Array<{ gtm: string; crm: string; score: number }>
  /** GTM fields with no match at all */
  unmapped: string[]
  /** CRM fields not mapped to anything */
  extraCrmFields: string[]
}

const CONFIDENT_THRESHOLD = 0.7
const UNCERTAIN_THRESHOLD = 0.4

/**
 * Auto-map GTM-OS canonical fields to CRM fields.
 * Returns confident/uncertain/unmapped categories so the setup wizard
 * can show the user what needs review.
 */
export function autoMapFields(crmFields: CRMFieldInfo[]): AutoMapResult {
  const gtmToCrm: Record<string, string> = {}
  const crmToGtm: Record<string, string> = {}
  const confident: AutoMapResult['confident'] = []
  const uncertain: AutoMapResult['uncertain'] = []
  const unmapped: string[] = []
  const usedCrmFields = new Set<string>()

  for (const gtmField of GTM_CANONICAL_FIELDS) {
    let bestMatch: { crm: string; score: number } | null = null

    for (const crmField of crmFields) {
      if (usedCrmFields.has(crmField.name)) continue

      // Check exact match against canonical key and all aliases
      const allNames = [gtmField.key, ...gtmField.aliases]
      let score = 0

      for (const alias of allNames) {
        const s = fieldSimilarity(alias, crmField.name)
        if (s > score) score = s
      }

      // Also check against CRM field description if available
      if (crmField.description) {
        for (const alias of allNames) {
          const s = fieldSimilarity(alias, crmField.description) * 0.6
          if (s > score) score = s
        }
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { crm: crmField.name, score }
      }
    }

    if (!bestMatch || bestMatch.score < UNCERTAIN_THRESHOLD) {
      unmapped.push(gtmField.key)
      continue
    }

    gtmToCrm[gtmField.key] = bestMatch.crm
    crmToGtm[bestMatch.crm] = gtmField.key
    usedCrmFields.add(bestMatch.crm)

    if (bestMatch.score >= CONFIDENT_THRESHOLD) {
      confident.push({ gtm: gtmField.key, crm: bestMatch.crm, score: bestMatch.score })
    } else {
      uncertain.push({ gtm: gtmField.key, crm: bestMatch.crm, score: bestMatch.score })
    }
  }

  const extraCrmFields = crmFields
    .map(f => f.name)
    .filter(name => !usedCrmFields.has(name))

  return {
    mapping: { gtmToCrm, crmToGtm },
    confident,
    uncertain,
    unmapped,
    extraCrmFields,
  }
}

/**
 * Apply a field mapping to transform a record from one schema to another.
 */
export function applyMapping(
  record: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    if (sourceKey in record) {
      result[targetKey] = record[sourceKey]
    }
  }
  return result
}
