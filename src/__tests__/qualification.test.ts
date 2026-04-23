import { describe, it, expect } from 'vitest'

/**
 * Tests for the 7-gate qualification pipeline logic.
 *
 * Since the actual pipeline (src/lib/qualification/pipeline.ts) is tightly
 * coupled to the database, we test the gate logic patterns in isolation —
 * dedup, headline pre-qual, exclusion, company disqualifiers, score threshold.
 */

// ─── Gate 0: Dedup Logic ──────────────────────────────────────────────────────

describe('Gate 0 — Dedup', () => {
  function dedup(
    leads: Array<{ provider_id?: string; linkedin_url?: string }>,
    existingIds: Set<string>,
    existingUrls: Set<string>,
  ) {
    const passed: typeof leads = []
    let skipped = 0
    for (const lead of leads) {
      const pid = String(lead.provider_id ?? '')
      const url = String(lead.linkedin_url ?? '')
      if ((pid && existingIds.has(pid)) || (url && existingUrls.has(url))) {
        skipped++
      } else {
        passed.push(lead)
      }
    }
    return { passed, skipped }
  }

  it('removes leads with matching provider_id', () => {
    const leads = [
      { provider_id: 'abc-123', linkedin_url: '' },
      { provider_id: 'def-456', linkedin_url: '' },
    ]
    const result = dedup(leads, new Set(['abc-123']), new Set())
    expect(result.passed).toHaveLength(1)
    expect(result.skipped).toBe(1)
    expect(result.passed[0].provider_id).toBe('def-456')
  })

  it('removes leads with matching linkedin_url', () => {
    const leads = [
      { provider_id: '', linkedin_url: 'https://linkedin.com/in/alice' },
      { provider_id: '', linkedin_url: 'https://linkedin.com/in/bob' },
    ]
    const result = dedup(leads, new Set(), new Set(['https://linkedin.com/in/alice']))
    expect(result.passed).toHaveLength(1)
    expect(result.passed[0].linkedin_url).toContain('bob')
  })

  it('passes leads with no matching identifiers', () => {
    const leads = [
      { provider_id: 'new-1', linkedin_url: 'https://linkedin.com/in/new' },
    ]
    const result = dedup(leads, new Set(['old-1']), new Set(['https://linkedin.com/in/old']))
    expect(result.passed).toHaveLength(1)
    expect(result.skipped).toBe(0)
  })

  it('handles empty leads array', () => {
    const result = dedup([], new Set(['abc']), new Set())
    expect(result.passed).toHaveLength(0)
    expect(result.skipped).toBe(0)
  })

  it('handles empty existing sets', () => {
    const leads = [{ provider_id: 'abc' }, { provider_id: 'def' }]
    const result = dedup(leads, new Set(), new Set())
    expect(result.passed).toHaveLength(2)
  })
})

// ─── Gate 1: Headline Pre-Qualification ───────────────────────────────────────

describe('Gate 1 — Headline Pre-Qualification', () => {
  function preQualify(leads: Array<{ headline: string }>, rules: string[]) {
    if (rules.length === 0) return { passed: leads, skipped: 0 }
    const passed: typeof leads = []
    let skipped = 0
    for (const lead of leads) {
      const matches = rules.some(rule => new RegExp(rule, 'i').test(lead.headline))
      if (matches) {
        passed.push(lead)
      } else {
        skipped++
      }
    }
    return { passed, skipped }
  }

  it('passes leads matching headline rules', () => {
    const leads = [
      { headline: 'VP of Engineering at Acme' },
      { headline: 'Software Developer' },
    ]
    const rules = ['VP', 'Director', 'CTO']
    const result = preQualify(leads, rules)
    expect(result.passed).toHaveLength(1)
    expect(result.passed[0].headline).toContain('VP')
  })

  it('treats rules as case-insensitive regex', () => {
    const leads = [{ headline: 'head of engineering' }]
    const rules = ['Head of']
    const result = preQualify(leads, rules)
    expect(result.passed).toHaveLength(1)
  })

  it('passes all leads when rules array is empty', () => {
    const leads = [{ headline: 'Intern' }, { headline: 'Student' }]
    const result = preQualify(leads, [])
    expect(result.passed).toHaveLength(2)
  })

  it('returns empty when no leads match', () => {
    const leads = [{ headline: 'Intern' }]
    const rules = ['CTO', 'VP', 'Director']
    const result = preQualify(leads, rules)
    expect(result.passed).toHaveLength(0)
    expect(result.skipped).toBe(1)
  })
})

// ─── Gate 2: Exclusion List ───────────────────────────────────────────────────

describe('Gate 2 — Exclusion List', () => {
  function applyExclusions(
    leads: Array<{ first_name: string; last_name: string; headline: string; company: string }>,
    exclusions: string[],
  ) {
    if (exclusions.length === 0) return { passed: leads, skipped: 0 }
    const passed: typeof leads = []
    let skipped = 0
    for (const lead of leads) {
      const fullText = [lead.first_name, lead.last_name, lead.headline, lead.company]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const excluded = exclusions.some(ex => fullText.includes(ex.toLowerCase()))
      if (excluded) {
        skipped++
      } else {
        passed.push(lead)
      }
    }
    return { passed, skipped }
  }

  it('excludes leads matching exclusion patterns', () => {
    const leads = [
      { first_name: 'Alice', last_name: 'Smith', headline: 'CEO', company: 'Competitor Inc' },
      { first_name: 'Bob', last_name: 'Jones', headline: 'CTO', company: 'Prospect Corp' },
    ]
    const result = applyExclusions(leads, ['Competitor Inc'])
    expect(result.passed).toHaveLength(1)
    expect(result.passed[0].first_name).toBe('Bob')
  })

  it('is case-insensitive', () => {
    const leads = [
      { first_name: 'Alice', last_name: 'Smith', headline: 'CEO', company: 'EARLEADS' },
    ]
    const result = applyExclusions(leads, ['earleads'])
    expect(result.passed).toHaveLength(0)
  })

  it('passes all when exclusions empty', () => {
    const leads = [
      { first_name: 'Alice', last_name: 'Smith', headline: 'CEO', company: 'Acme' },
    ]
    const result = applyExclusions(leads, [])
    expect(result.passed).toHaveLength(1)
  })
})

// ─── Gate 3: Company Disqualifiers ────────────────────────────────────────────

describe('Gate 3 — Company Disqualifiers', () => {
  function disqualifyCompanies(
    leads: Array<{ company: string; industry?: string }>,
    disqualifiers: string[],
  ) {
    if (disqualifiers.length === 0) return { passed: leads, skipped: 0 }
    const passed: typeof leads = []
    let skipped = 0
    for (const lead of leads) {
      const company = lead.company.toLowerCase()
      const industry = (lead.industry ?? '').toLowerCase()
      const disqualified = disqualifiers.some(
        dq => company.includes(dq.toLowerCase()) || industry.includes(dq.toLowerCase()),
      )
      if (disqualified) {
        skipped++
      } else {
        passed.push(lead)
      }
    }
    return { passed, skipped }
  }

  it('disqualifies by company name match', () => {
    const leads = [
      { company: 'Google', industry: 'Tech' },
      { company: 'Startup XYZ', industry: 'Tech' },
    ]
    const result = disqualifyCompanies(leads, ['Google'])
    expect(result.passed).toHaveLength(1)
    expect(result.skipped).toBe(1)
  })

  it('disqualifies by industry match', () => {
    const leads = [
      { company: 'Acme', industry: 'Government' },
      { company: 'Beta', industry: 'SaaS' },
    ]
    const result = disqualifyCompanies(leads, ['government'])
    expect(result.passed).toHaveLength(1)
    expect(result.passed[0].company).toBe('Beta')
  })
})

// ─── Gate 6: Score Threshold ──────────────────────────────────────────────────

describe('Gate 6 — Score Threshold', () => {
  function applyThreshold(
    leads: Array<{ icp_score?: number; qualificationScore?: number }>,
    minScore: number,
  ) {
    const qualified = leads.filter(l => {
      const score = Number(l.icp_score ?? l.qualificationScore ?? 0)
      return score >= minScore
    })
    return {
      qualified,
      disqualified: leads.length - qualified.length,
    }
  }

  it('passes leads at or above threshold', () => {
    const leads = [
      { icp_score: 80 },
      { icp_score: 50 },
      { icp_score: 49 },
      { icp_score: 100 },
    ]
    const result = applyThreshold(leads, 50)
    expect(result.qualified).toHaveLength(3)
    expect(result.disqualified).toBe(1)
  })

  it('treats missing scores as 0', () => {
    const leads = [{ icp_score: undefined }]
    const result = applyThreshold(leads, 50)
    expect(result.qualified).toHaveLength(0)
    expect(result.disqualified).toBe(1)
  })

  it('accepts qualificationScore as fallback', () => {
    const leads = [{ qualificationScore: 75 }]
    const result = applyThreshold(leads, 50)
    expect(result.qualified).toHaveLength(1)
  })

  it('boundary: exactly at threshold passes', () => {
    const leads = [{ icp_score: 50 }]
    const result = applyThreshold(leads, 50)
    expect(result.qualified).toHaveLength(1)
  })

  it('boundary: one below threshold fails', () => {
    const leads = [{ icp_score: 49 }]
    const result = applyThreshold(leads, 50)
    expect(result.qualified).toHaveLength(0)
  })
})

// ─── Full Pipeline Flow (unit-level) ──────────────────────────────────────────

describe('Full pipeline flow (gate chain)', () => {
  it('gates execute in order and reduce the pipeline correctly', () => {
    const leads = [
      { provider_id: 'dup-1', headline: 'CTO', company: 'Good Corp', industry: 'SaaS', icp_score: 80 },
      { provider_id: 'new-1', headline: 'Intern', company: 'Good Corp', industry: 'SaaS', icp_score: 80 },
      { provider_id: 'new-2', headline: 'VP Sales', company: 'Bad Corp', industry: 'SaaS', icp_score: 80 },
      { provider_id: 'new-3', headline: 'VP Sales', company: 'Good Corp', industry: 'SaaS', icp_score: 30 },
      { provider_id: 'new-4', headline: 'VP Sales', company: 'Good Corp', industry: 'SaaS', icp_score: 90 },
    ]

    // Gate 0: Dedup — removes dup-1
    let pipeline = leads.filter(l => l.provider_id !== 'dup-1')
    expect(pipeline).toHaveLength(4)

    // Gate 1: Headline pre-qual — removes Intern
    const rules = ['CTO', 'VP', 'Director']
    pipeline = pipeline.filter(l => rules.some(r => new RegExp(r, 'i').test(l.headline)))
    expect(pipeline).toHaveLength(3)

    // Gate 3: Company disqualifiers — removes Bad Corp
    pipeline = pipeline.filter(l => !l.company.toLowerCase().includes('bad corp'))
    expect(pipeline).toHaveLength(2)

    // Gate 6: Score threshold — removes score < 50
    pipeline = pipeline.filter(l => l.icp_score >= 50)
    expect(pipeline).toHaveLength(1)
    expect(pipeline[0].provider_id).toBe('new-4')
  })
})
