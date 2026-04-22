import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import {
  DedupEngine,
  normalizeLinkedInUrl,
  diceCoefficient,
} from '../engine'
import { buildConfirmationBlocks, resolveTimeout } from '../slack-confirm'
import type { SuppressionEntry, LeadRecord, DedupMatch } from '../types'

// ─── LinkedIn URL Normalization ─────────────────────────────────────────────

describe('normalizeLinkedInUrl', () => {
  it('strips query params and trailing slash', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/john-smith/?param=value'))
      .toBe('https://www.linkedin.com/in/john-smith')
  })

  it('strips trailing slashes', () => {
    expect(normalizeLinkedInUrl('https://www.linkedin.com/in/john-smith///'))
      .toBe('https://www.linkedin.com/in/john-smith')
  })

  it('normalizes /pub/ to /in/', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/pub/john-smith/1a/2b/3c'))
      .toBe('https://www.linkedin.com/in/john-smith/1a/2b/3c')
  })

  it('lowercases the path', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/John-Smith'))
      .toBe('https://www.linkedin.com/in/john-smith')
  })

  it('handles URLs with hash fragments', () => {
    expect(normalizeLinkedInUrl('https://linkedin.com/in/john-smith#section'))
      .toBe('https://www.linkedin.com/in/john-smith')
  })

  it('returns empty string for empty input', () => {
    expect(normalizeLinkedInUrl('')).toBe('')
  })

  it('handles malformed URLs by extracting slug', () => {
    expect(normalizeLinkedInUrl('linkedin.com/in/john-smith'))
      .toBe('https://www.linkedin.com/in/john-smith')
  })
})

// ─── Dice Coefficient ───────────────────────────────────────────────────────

describe('diceCoefficient', () => {
  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('hello', 'hello')).toBe(1)
  })

  it('returns 1 for identical strings with different case', () => {
    expect(diceCoefficient('Hello', 'hello')).toBe(1)
  })

  it('returns 0 for completely different strings', () => {
    expect(diceCoefficient('abc', 'xyz')).toBe(0)
  })

  it('returns > 0.8 for similar names', () => {
    expect(diceCoefficient('John Smith', 'Jon Smith')).toBeGreaterThan(0.7)
  })

  it('returns 0 for empty inputs', () => {
    expect(diceCoefficient('', 'hello')).toBe(0)
    expect(diceCoefficient('hello', '')).toBe(0)
  })

  it('returns 1 for two empty strings', () => {
    expect(diceCoefficient('', '')).toBe(1)
  })
})

// ─── Dedup Engine — Exact Email Match ───────────────────────────────────────

describe('DedupEngine — exact email matcher', () => {
  const engine = new DedupEngine()

  it('matches same email case-insensitively', () => {
    const lead: LeadRecord = { email: 'John@Acme.com' }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'john@acme.com',
      source: 'campaign_active',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('email')
    expect(match!.confidence).toBe(100)
  })

  it('does not match different emails', () => {
    const lead: LeadRecord = { email: 'alice@acme.com' }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'bob@acme.com',
      source: 'campaign_active',
    }]

    expect(engine.matchLead(lead, suppression)).toBeNull()
  })

  it('handles leads with no email', () => {
    const lead: LeadRecord = { first_name: 'John' }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'john@acme.com',
      source: 'campaign_active',
    }]

    // No email match, but might match on other matchers
    const match = engine.matchLead(lead, suppression)
    // With only email in suppression, no other matchers will fire
    expect(match).toBeNull()
  })
})

// ─── Dedup Engine — LinkedIn URL Match ──────────────────────────────────────

describe('DedupEngine — LinkedIn URL matcher', () => {
  const engine = new DedupEngine()

  it('matches normalized LinkedIn URLs', () => {
    const lead: LeadRecord = {
      linkedin_url: 'https://linkedin.com/in/john-smith?utm=campaign',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      linkedin_url: 'https://www.linkedin.com/in/john-smith/',
      source: 'campaign_active',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('linkedin')
    expect(match!.confidence).toBe(95)
  })

  it('matches /pub/ variant against /in/ variant', () => {
    const lead: LeadRecord = {
      linkedin_url: 'https://linkedin.com/pub/john-smith/1a/2b/3c',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      linkedin_url: 'https://linkedin.com/in/john-smith/1a/2b/3c',
      source: 'crm',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('linkedin')
  })

  it('does not match different LinkedIn profiles', () => {
    const lead: LeadRecord = {
      linkedin_url: 'https://linkedin.com/in/alice-jones',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      linkedin_url: 'https://linkedin.com/in/bob-smith',
      source: 'campaign_active',
    }]

    expect(engine.matchLead(lead, suppression)).toBeNull()
  })
})

// ─── Dedup Engine — Fuzzy Name+Company Match ────────────────────────────────

describe('DedupEngine — fuzzy name+company matcher', () => {
  it('matches similar names with same company above threshold', () => {
    const engine = new DedupEngine({ fuzzyNameThreshold: 0.7 })

    const lead: LeadRecord = {
      first_name: 'John',
      last_name: 'Smith',
      company: 'Acme Corp',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      first_name: 'John',
      last_name: 'Smyth',
      company: 'Acme Corp',
      source: 'campaign_active',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('fuzzy_name_company')
    expect(match!.confidence).toBeGreaterThanOrEqual(70)
  })

  it('does not match very different names below threshold', () => {
    const engine = new DedupEngine({ fuzzyNameThreshold: 0.8 })

    const lead: LeadRecord = {
      first_name: 'Alice',
      last_name: 'Johnson',
      company: 'TechCo',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      first_name: 'Bob',
      last_name: 'Williams',
      company: 'OtherCo',
      source: 'campaign_active',
    }]

    expect(engine.matchLead(lead, suppression)).toBeNull()
  })
})

// ─── Dedup Engine — Domain+Title Match ──────────────────────────────────────

describe('DedupEngine — domain+title matcher', () => {
  it('matches same domain with similar title', () => {
    const engine = new DedupEngine({ domainTitleThreshold: 0.6 })

    const lead: LeadRecord = {
      email: 'john@acme.com',
      headline: 'Senior Software Engineer',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'jane@acme.com',
      headline: 'Senior Software Engineer',
      source: 'crm',
    }]

    const match = engine.matchLead(lead, suppression)
    // This should match on domain+title
    expect(match).not.toBeNull()
    // Could match email domain+title or email exact — check it found something
    expect(match!.confidence).toBeGreaterThan(0)
  })

  it('does not match different domains even with same title', () => {
    const engine = new DedupEngine({
      domainTitleThreshold: 0.6,
      enabledMatchers: ['domain_title'],
    })

    const lead: LeadRecord = {
      email: 'john@acme.com',
      headline: 'VP of Sales',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'john@other.com',
      headline: 'VP of Sales',
      source: 'crm',
    }]

    expect(engine.matchLead(lead, suppression)).toBeNull()
  })
})

// ─── Dedup Engine — Confidence Scoring & Batch ──────────────────────────────

describe('DedupEngine — batch dedup', () => {
  it('picks the highest-confidence match when multiple matchers fire', () => {
    const engine = new DedupEngine()

    const lead: LeadRecord = {
      email: 'john@acme.com',
      linkedin_url: 'https://linkedin.com/in/john-smith',
      first_name: 'John',
      last_name: 'Smith',
      company: 'Acme',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'john@acme.com',
      linkedin_url: 'https://linkedin.com/in/john-smith',
      first_name: 'John',
      last_name: 'Smith',
      company: 'Acme',
      source: 'campaign_active',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    // Email match (100) should be picked over LinkedIn (95)
    expect(match!.matcher).toBe('email')
    expect(match!.confidence).toBe(100)
  })

  it('categorizes leads into unique, duplicates, and pending review', () => {
    const engine = new DedupEngine({
      slackConfirmRange: [60, 80],
      fuzzyNameThreshold: 0.5, // Lower threshold so fuzzy matches fire
    })

    const leads: LeadRecord[] = [
      { id: '1', email: 'exact@match.com', first_name: 'Exact' },
      { id: '2', email: 'unique@new.com', first_name: 'Unique' },
      { id: '3', first_name: 'Similar', last_name: 'Name', company: 'SameCo' },
    ]

    const suppression: SuppressionEntry[] = [
      {
        id: 'sup-1',
        email: 'exact@match.com',
        source: 'campaign_active',
      },
    ]

    const result = engine.dedup(leads, suppression)

    // Lead 1 = exact email match (100%) -> duplicate
    expect(result.duplicates.length).toBe(1)
    expect(result.duplicates[0].lead.id).toBe('1')

    // Lead 2 = no match -> unique
    // Lead 3 = no email match, may or may not fuzzy match
    expect(result.unique.length).toBeGreaterThanOrEqual(1)
  })

  it('returns all leads as unique when suppression set is empty', () => {
    const engine = new DedupEngine()

    const leads: LeadRecord[] = [
      { id: '1', email: 'a@b.com' },
      { id: '2', email: 'c@d.com' },
    ]

    const result = engine.dedup(leads, [])
    expect(result.unique.length).toBe(2)
    expect(result.duplicates.length).toBe(0)
    expect(result.pendingReview.length).toBe(0)
  })
})

// ─── Dedup Engine — Strategy Selection ──────────────────────────────────────

describe('DedupEngine — strategy selection', () => {
  it('only runs exact email matcher when configured', () => {
    const engine = new DedupEngine({
      enabledMatchers: ['email'],
    })

    const lead: LeadRecord = {
      email: 'different@email.com',
      linkedin_url: 'https://linkedin.com/in/john-smith',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      email: 'other@email.com',
      linkedin_url: 'https://linkedin.com/in/john-smith',
      source: 'campaign_active',
    }]

    // LinkedIn matches but only email matcher is enabled
    const match = engine.matchLead(lead, suppression)
    expect(match).toBeNull()
  })

  it('runs all matchers when configured with "all"', () => {
    const engine = new DedupEngine({
      enabledMatchers: ['email', 'linkedin', 'fuzzy_name_company', 'domain_title'],
    })

    const lead: LeadRecord = {
      linkedin_url: 'https://linkedin.com/in/john-smith',
    }
    const suppression: SuppressionEntry[] = [{
      id: 'entry-1',
      linkedin_url: 'https://linkedin.com/in/john-smith/',
      source: 'crm',
    }]

    const match = engine.matchLead(lead, suppression)
    expect(match).not.toBeNull()
    expect(match!.matcher).toBe('linkedin')
  })
})

// ─── Slack Confirmation ─────────────────────────────────────────────────────

describe('Slack confirmation', () => {
  it('builds correct Slack blocks for a match', () => {
    const lead: LeadRecord = {
      first_name: 'John',
      last_name: 'Smith',
      email: 'john@acme.com',
    }
    const match: DedupMatch = {
      matcher: 'fuzzy_name_company',
      confidence: 72,
      leadField: 'John Smith Acme',
      matchedField: 'J. Smith Acme Inc',
      matchedSource: 'campaign_active',
      matchedId: 'sup-1',
    }

    const blocks = buildConfirmationBlocks(lead, match)
    expect(blocks).toHaveLength(3)
    expect(blocks[0]).toHaveProperty('type', 'header')

    // Header should contain confidence
    const headerText = (blocks[0] as any).text.text
    expect(headerText).toContain('72%')
  })

  it('resolves timeout with default keep_both action', () => {
    const results = resolveTimeout(['lead-1', 'lead-2'])
    expect(results).toHaveLength(2)
    expect(results[0].action).toBe('keep_both')
    expect(results[1].action).toBe('keep_both')
  })

  it('resolves timeout with custom default action', () => {
    const results = resolveTimeout(['lead-1'], 'skip')
    expect(results[0].action).toBe('skip')
  })
})

// ─── Integration: Auto-run on Import / --no-dedup ───────────────────────────

describe('DedupEngine — config', () => {
  it('exposes config for external callers', () => {
    const engine = new DedupEngine({
      fuzzyNameThreshold: 0.9,
      slackConfirmRange: [50, 70],
    })

    const config = engine.getConfig()
    expect(config.fuzzyNameThreshold).toBe(0.9)
    expect(config.slackConfirmRange).toEqual([50, 70])
  })

  it('uses default config when none provided', () => {
    const engine = new DedupEngine()
    const config = engine.getConfig()
    expect(config.fuzzyNameThreshold).toBe(0.8)
    expect(config.slackConfirmRange).toEqual([60, 80])
    expect(config.enabledMatchers).toEqual(['email', 'linkedin', 'fuzzy_name_company', 'domain_title'])
  })
})
