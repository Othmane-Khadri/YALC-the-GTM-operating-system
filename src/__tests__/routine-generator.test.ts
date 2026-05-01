/**
 * Unit tests for the Routine Generator predicates (per spec §4.1).
 *
 * Each archetype's `canRunWith` predicate is tested with full env, missing
 * provider, missing context field, and missing Anthropic key. The generator
 * is pure — no `~/.gtm-os/` is touched (every input is passed in).
 */

import { describe, it, expect } from 'vitest'
import {
  canRunCompetitorAudienceMining,
  canRunContentCalendarBuilder,
  canRunOutreachCampaignBuilder,
  canRunLeadMagnetBuilder,
  generateRoutine,
} from '../lib/routine/generator'
import type { CompanyContext } from '../lib/framework/context-types'

function richContext(over: Partial<CompanyContext> = {}): CompanyContext {
  const base: CompanyContext = {
    company: { name: 'Acme', website: 'https://acme.test', description: 'desc' },
    founder: { name: 'Founder', linkedin: '' },
    icp: {
      segments_freeform: 'Series A SaaS CTOs',
      pain_points: ['ops drift'],
      competitors: ['https://www.linkedin.com/company/competitor/'],
      subreddits: [],
      target_communities: [],
    },
    voice: { description: '', examples_path: '' },
    sources: { linkedin_account_id: 'acct_123' },
    meta: { captured_at: 't', last_updated_at: 't' },
    signals: {
      buyingIntentSignals: [],
      monitoringKeywords: ['rev ops drift'],
      triggerEvents: [],
    },
  }
  return { ...base, ...over }
}

describe('canRunCompetitorAudienceMining (archetype A)', () => {
  it('true when unipile + ANTHROPIC + competitors + linkedin_account_id', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('false when unipile missing', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(false)
  })

  it('false when ANTHROPIC missing', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: false,
        context: richContext(),
      }),
    ).toBe(false)
  })

  it('false when competitors empty AND competitors_detail empty', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext({
          icp: {
            ...richContext().icp,
            competitors: [],
            competitors_detail: [],
          },
        }),
      }),
    ).toBe(false)
  })

  it('true when competitors empty BUT competitors_detail non-empty', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext({
          icp: {
            ...richContext().icp,
            competitors: [],
            competitors_detail: [
              {
                name: 'X',
                website: 'x.test',
                positioning: 'p',
                weaknesses: [],
                battlecardNotes: '',
              },
            ],
          },
        }),
      }),
    ).toBe(true)
  })

  it('false when linkedin_account_id missing', () => {
    expect(
      canRunCompetitorAudienceMining({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext({ sources: {} }),
      }),
    ).toBe(false)
  })
})

describe('canRunContentCalendarBuilder (archetype B)', () => {
  it('true with ANTHROPIC + unipile', () => {
    expect(
      canRunContentCalendarBuilder({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('true with ANTHROPIC + monitoringKeywords (no unipile)', () => {
    expect(
      canRunContentCalendarBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('false when neither unipile nor monitoringKeywords', () => {
    expect(
      canRunContentCalendarBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: richContext({
          signals: {
            buyingIntentSignals: [],
            monitoringKeywords: [],
            triggerEvents: [],
          },
        }),
      }),
    ).toBe(false)
  })

  it('false when ANTHROPIC missing', () => {
    expect(
      canRunContentCalendarBuilder({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: false,
        context: richContext(),
      }),
    ).toBe(false)
  })
})

describe('canRunOutreachCampaignBuilder (archetype C)', () => {
  it('true with ANTHROPIC + unipile', () => {
    expect(
      canRunOutreachCampaignBuilder({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('true with ANTHROPIC + instantly', () => {
    expect(
      canRunOutreachCampaignBuilder({
        capabilitiesAvailable: ['instantly'],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('false with no outbound channel', () => {
    expect(
      canRunOutreachCampaignBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(false)
  })

  it('false with no ANTHROPIC', () => {
    expect(
      canRunOutreachCampaignBuilder({
        capabilitiesAvailable: ['unipile'],
        envHasAnthropic: false,
        context: richContext(),
      }),
    ).toBe(false)
  })
})

describe('canRunLeadMagnetBuilder (archetype D)', () => {
  it('true when ANTHROPIC is present', () => {
    expect(
      canRunLeadMagnetBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: richContext(),
      }),
    ).toBe(true)
  })

  it('false when ANTHROPIC missing', () => {
    expect(
      canRunLeadMagnetBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: false,
        context: richContext(),
      }),
    ).toBe(false)
  })

  it('true with empty providers and no rich context (just ANTHROPIC)', () => {
    expect(
      canRunLeadMagnetBuilder({
        capabilitiesAvailable: [],
        envHasAnthropic: true,
        context: null,
      }),
    ).toBe(true)
  })
})

describe('generateRoutine — matrix snapshots (per spec §4 + §8)', () => {
  it('empty env: returns empty routine + helpful note', () => {
    const r = generateRoutine({
      capabilitiesAvailable: [],
      envHasAnthropic: false,
      archetype: null,
      context: null,
    })
    expect(r.frameworks).toHaveLength(0)
    expect(r.defaultDashboard).toBe('/frameworks')
    expect(r.archetypes).toEqual([])
    expect(r.notes.some((n) => n.toLowerCase().includes('anthropic'))).toBe(true)
  })

  it('Anthropic-only: only D eligible', () => {
    const r = generateRoutine({
      capabilitiesAvailable: [],
      envHasAnthropic: true,
      archetype: null,
      context: null,
    })
    expect(r.frameworks.map((f) => f.framework)).toEqual(['lead-magnet-builder'])
    expect(r.defaultDashboard).toBe('/frameworks/lead-magnet-builder')
    expect(r.archetypes).toEqual(['D'])
    // Note recommends provider:add unipile to unlock A/B
    expect(r.notes.some((n) => n.toLowerCase().includes('provider:add'))).toBe(true)
  })

  it('Anthropic + Unipile + competitors_detail: A primary, A+B+D, dashboard A', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['unipile'],
      envHasAnthropic: true,
      archetype: null,
      context: ({
        company: { name: 'X', website: '', description: '' },
        founder: { name: '', linkedin: '' },
        icp: {
          segments_freeform: '',
          pain_points: [],
          competitors: ['https://www.linkedin.com/company/x/'],
          subreddits: [],
          target_communities: [],
        },
        voice: { description: '', examples_path: '' },
        sources: { linkedin_account_id: 'acct' },
        meta: { captured_at: '', last_updated_at: '' },
      } as CompanyContext),
    })
    const names = r.frameworks.map((f) => f.framework)
    expect(names).toContain('competitor-audience-mining')
    expect(names).toContain('content-calendar-builder')
    expect(names).toContain('lead-magnet-builder')
    expect(r.defaultDashboard).toBe('/frameworks/competitor-audience-mining')
    expect(r.archetypes[0]).toBe('A')
  })

  it('Anthropic + Unipile but no linkedin_account_id: A excluded, B + D only', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['unipile'],
      envHasAnthropic: true,
      archetype: null,
      context: ({
        company: { name: '', website: '', description: '' },
        founder: { name: '', linkedin: '' },
        icp: {
          segments_freeform: '',
          pain_points: [],
          competitors: ['x'],
          subreddits: [],
          target_communities: [],
        },
        voice: { description: '', examples_path: '' },
        sources: {},
        meta: { captured_at: '', last_updated_at: '' },
      } as CompanyContext),
    })
    const names = r.frameworks.map((f) => f.framework)
    expect(names).not.toContain('competitor-audience-mining')
    expect(names).toContain('content-calendar-builder')
    expect(names).toContain('lead-magnet-builder')
    expect(r.defaultDashboard).toBe('/frameworks/content-calendar-builder')
  })

  it('Anthropic + Instantly + locked hypothesis: C eligible (not deferred), D, dashboard C if no A/B', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['instantly'],
      envHasAnthropic: true,
      archetype: null,
      hypothesisLocked: true,
      context: null,
    })
    const c = r.frameworks.find((f) => f.framework === 'outreach-campaign-builder')
    expect(c).toBeDefined()
    expect(c?.deferred).toBeUndefined()
    expect(r.defaultDashboard).toBe('/frameworks/outreach-campaign-builder')
  })

  it('Anthropic + Instantly + NO hypothesis: C deferred', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['instantly'],
      envHasAnthropic: true,
      archetype: null,
      hypothesisLocked: false,
      context: null,
    })
    const c = r.frameworks.find((f) => f.framework === 'outreach-campaign-builder')
    expect(c).toBeDefined()
    expect(c?.deferred).toBe(true)
    expect(c?.rationale.toLowerCase()).toContain('hypothesis')
  })

  it('full env: A + B + C + D, A primary', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['unipile', 'instantly'],
      envHasAnthropic: true,
      archetype: null,
      hypothesisLocked: true,
      context: ({
        company: { name: '', website: '', description: '' },
        founder: { name: '', linkedin: '' },
        icp: {
          segments_freeform: '',
          pain_points: [],
          competitors: ['x'],
          subreddits: [],
          target_communities: [],
        },
        voice: { description: '', examples_path: '' },
        sources: { linkedin_account_id: 'acct' },
        meta: { captured_at: '', last_updated_at: '' },
        signals: {
          buyingIntentSignals: [],
          monitoringKeywords: ['ops drift'],
          triggerEvents: [],
        },
      } as CompanyContext),
    })
    const names = r.frameworks.map((f) => f.framework).sort()
    expect(names).toEqual(
      [
        'competitor-audience-mining',
        'content-calendar-builder',
        'lead-magnet-builder',
        'outreach-campaign-builder',
      ].sort(),
    )
    expect(r.defaultDashboard).toBe('/frameworks/competitor-audience-mining')
    expect(r.archetypes).toEqual(['A', 'B', 'C', 'D'])
  })

  it('respects pinned archetype preference for dashboard primary when multiple archetypes match', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['unipile'],
      envHasAnthropic: true,
      archetype: 'b', // user pinned B
      context: ({
        company: { name: '', website: '', description: '' },
        founder: { name: '', linkedin: '' },
        icp: {
          segments_freeform: '',
          pain_points: [],
          competitors: ['x'],
          subreddits: [],
          target_communities: [],
        },
        voice: { description: '', examples_path: '' },
        sources: { linkedin_account_id: 'acct' },
        meta: { captured_at: '', last_updated_at: '' },
      } as CompanyContext),
    })
    expect(r.defaultDashboard).toBe('/frameworks/content-calendar-builder')
  })

  it('schedule defaults are read from yaml + on-demand frameworks omit schedule', () => {
    const r = generateRoutine({
      capabilitiesAvailable: ['unipile'],
      envHasAnthropic: true,
      archetype: null,
      context: ({
        company: { name: '', website: '', description: '' },
        founder: { name: '', linkedin: '' },
        icp: {
          segments_freeform: '',
          pain_points: [],
          competitors: ['x'],
          subreddits: [],
          target_communities: [],
        },
        voice: { description: '', examples_path: '' },
        sources: { linkedin_account_id: 'acct' },
        meta: { captured_at: '', last_updated_at: '' },
      } as CompanyContext),
    })
    const a = r.frameworks.find((f) => f.framework === 'competitor-audience-mining')
    expect(a?.schedule?.cron).toBe('0 9 * * *')
    const d = r.frameworks.find((f) => f.framework === 'lead-magnet-builder')
    expect(d?.schedule).toBeUndefined()
  })
})
