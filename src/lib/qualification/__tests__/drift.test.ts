import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { looselyMatch, matchesAnyPattern, computeDriftFlags } from '../pipeline'
import type { VerifiedFields } from '../types'

// ─── looselyMatch ─────────────────────────────────────────────────────────────

describe('looselyMatch — token-overlap matching', () => {
  it('matches when meaningful tokens overlap (Director, Head, of, Sales)', () => {
    expect(
      looselyMatch(
        'Sr. Director, Head of Sales — Retirement Services',
        'Senior Director Head of Sales',
      ),
    ).toBe(true)
  })

  it('does NOT match completely-different titles (no token overlap)', () => {
    // "VP Sales at CoStar" vs "Senior Director" — zero shared tokens.
    expect(looselyMatch('VP Sales at CoStar', 'Senior Director')).toBe(false)
  })

  it('returns false for empty strings', () => {
    expect(looselyMatch('', 'VP Sales')).toBe(false)
    expect(looselyMatch('VP Sales', '')).toBe(false)
    expect(looselyMatch('', '')).toBe(false)
  })

  it('returns true for identical strings', () => {
    expect(looselyMatch('Chief Revenue Officer', 'Chief Revenue Officer')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(looselyMatch('VP Sales', 'vp sales')).toBe(true)
    expect(looselyMatch('CHIEF REVENUE OFFICER', 'chief revenue officer')).toBe(true)
  })

  it('handles punctuation by stripping it', () => {
    expect(looselyMatch('VP, Sales!', 'VP Sales')).toBe(true)
  })

  it('VP of Sales loosely matches VP Sales', () => {
    expect(looselyMatch('VP Sales', 'VP of Sales')).toBe(true)
  })
})

// ─── matchesAnyPattern ────────────────────────────────────────────────────────

describe('matchesAnyPattern — case-insensitive substring + synonyms', () => {
  it('matches "Aon" against ["Aon", "Marsh"]', () => {
    expect(matchesAnyPattern('Aon', ['Aon', 'Marsh'])).toBe(true)
  })

  it('matches "AON Plc" against ["aon"] (case-insensitive)', () => {
    expect(matchesAnyPattern('AON Plc', ['aon'])).toBe(true)
  })

  it('matches "Insurance Broker" against ["insurance"] via synonym', () => {
    expect(matchesAnyPattern('Insurance Broker', ['insurance'])).toBe(true)
  })

  it('matches "HRIS" against ["HR information systems"] via synonym map', () => {
    expect(matchesAnyPattern('HRIS', ['HR information systems'])).toBe(true)
  })

  it('does NOT match "Random Co" against ["Aon", "Marsh"]', () => {
    expect(matchesAnyPattern('Random Co', ['Aon', 'Marsh'])).toBe(false)
  })

  it('returns false for empty text', () => {
    expect(matchesAnyPattern('', ['Aon', 'Marsh'])).toBe(false)
  })

  it('returns false for empty patterns array', () => {
    expect(matchesAnyPattern('Aon', [])).toBe(false)
  })

  it('reverse substring also matches (text inside pattern)', () => {
    // The verified industry "insurance" should match the disqualifier "insurance broker"
    expect(matchesAnyPattern('insurance', ['insurance broker'])).toBe(true)
  })
})

// ─── computeDriftFlags ────────────────────────────────────────────────────────

describe('computeDriftFlags — title_mismatch', () => {
  it('flags title_mismatch=true when source vs verified positions do not loosely match', () => {
    const verified: VerifiedFields = {
      headline: 'Senior Director at UKG',
      primary_company: 'UKG',
      primary_position: 'Senior Director',
      primary_company_industry: 'HCM software',
      prior_companies: [],
      current_role_start_date: '2022-01-01',
      all_active_roles: [],
      throttled: false,
    }
    const lead = {
      title: 'VP Sales at CoStar',
      verified,
    }
    const drift = computeDriftFlags(lead)
    expect(drift.title_mismatch).toBe(true)
  })

  it('flags title_mismatch=false when source vs verified loosely match (VP Sales / VP of Sales)', () => {
    const verified: VerifiedFields = {
      headline: 'VP of Sales at Acme',
      primary_company: 'Acme',
      primary_position: 'VP of Sales',
      primary_company_industry: 'SaaS',
      prior_companies: [],
      current_role_start_date: '2022-01-01',
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'VP Sales', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.title_mismatch).toBe(false)
  })
})

describe('computeDriftFlags — ex_employer_in_headline', () => {
  it('flags ex_employer_in_headline=true for headline "ex-UKG | Senior Director"', () => {
    const verified: VerifiedFields = {
      headline: 'ex-UKG | Senior Director',
      primary_company: 'NewCo',
      primary_position: 'Senior Director',
      primary_company_industry: 'HCM',
      prior_companies: ['UKG'],
      current_role_start_date: '2024-01-01',
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'Senior Director', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.ex_employer_in_headline).toBe(true)
  })

  it('flags ex_employer_in_headline=true for headline "ex-Google Cloud & UKG"', () => {
    const verified: VerifiedFields = {
      headline: 'ex-Google Cloud & UKG',
      primary_company: 'NewCo',
      primary_position: 'Senior Director',
      primary_company_industry: 'HCM',
      prior_companies: [],
      current_role_start_date: '2024-01-01',
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'Senior Director', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.ex_employer_in_headline).toBe(true)
  })

  it('flags ex_employer_in_headline=false for headline without "ex-" prefix', () => {
    const verified: VerifiedFields = {
      headline: 'Senior Director at UKG',
      primary_company: 'UKG',
      primary_position: 'Senior Director',
      primary_company_industry: 'HCM',
      prior_companies: [],
      current_role_start_date: '2024-01-01',
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'Senior Director', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.ex_employer_in_headline).toBe(false)
  })
})

describe('computeDriftFlags — recent_role_change', () => {
  it('flags recent_role_change=true when current_role_start_date is 10 days ago', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const verified: VerifiedFields = {
      headline: 'CEO at NewCo',
      primary_company: 'NewCo',
      primary_position: 'CEO',
      primary_company_industry: 'SaaS',
      prior_companies: [],
      current_role_start_date: tenDaysAgo,
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'CEO', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.recent_role_change).toBe(true)
  })

  it('flags recent_role_change=false when current_role_start_date is 60 days ago', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const verified: VerifiedFields = {
      headline: 'CEO at NewCo',
      primary_company: 'NewCo',
      primary_position: 'CEO',
      primary_company_industry: 'SaaS',
      prior_companies: [],
      current_role_start_date: sixtyDaysAgo,
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'CEO', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.recent_role_change).toBe(false)
  })

  it('flags recent_role_change=false when current_role_start_date is null', () => {
    const verified: VerifiedFields = {
      headline: 'CEO at NewCo',
      primary_company: 'NewCo',
      primary_position: 'CEO',
      primary_company_industry: 'SaaS',
      prior_companies: [],
      current_role_start_date: null,
      all_active_roles: [],
      throttled: false,
    }
    const lead = { title: 'CEO', verified }
    const drift = computeDriftFlags(lead)
    expect(drift.recent_role_change).toBe(false)
  })
})

describe('computeDriftFlags — verified missing', () => {
  it('returns all flags false when verified is undefined', () => {
    const lead = { title: 'CEO' }
    const drift = computeDriftFlags(lead)
    expect(drift).toEqual({
      title_mismatch: false,
      ex_employer_in_headline: false,
      recent_role_change: false,
    })
  })
})
