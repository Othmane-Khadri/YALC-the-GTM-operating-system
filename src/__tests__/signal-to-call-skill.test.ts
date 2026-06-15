/**
 * signal-to-call skill: orchestration + frontmatter tests.
 *
 * Verifies the four acceptance criteria:
 *   1. Fixture run: a job posting URL goes in, dryrun JSON is written,
 *      hard-approval is enforced (no side effect before approval).
 *   2. After approval: contactUpsert, attachNote, createTask, sendSlack
 *      each called exactly once.
 *   3. Task dueAt = now() + 12 hours ISO string, timezone-stable.
 *   4. Opener with em-dash or en-dash is rejected by the dash-scan rule.
 *   5. EU prospect: Fiber returns 0 phones -> email-only payload with
 *      phone_unavailable_reason = 'fiber_eu_coverage_gap'.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  runSignalToCall,
  APPROVAL_PROMPT,
  validateOpener,
  resolvePersona,
  deriveSeniority,
  computeDueAt,
  extractCountryCode,
  timezoneForCountry,
  type Deps,
  type SignalInput,
  type FrameworkLike,
  type FiberResult,
  type FullenrichResult,
  type DryrunPayload,
} from '../lib/skills/signal-to-call/orchestrator'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'signal-to-call')

const TRIGGER_PHRASES = [
  'turn this job posting into a cold call',
  'agent 1 from this signal',
  'signal to call for [URL]',
  'spin a verified mobile + 12h task from this hire',
  'one prompt from job url to HubSpot task',
]

const FIXTURE_US: SignalInput = JSON.parse(
  readFileSync(join(SKILL_DIR, '__tests__', 'fixtures', 'job-posting-us.json'), 'utf-8'),
)
const FIXTURE_EU: SignalInput = JSON.parse(
  readFileSync(join(SKILL_DIR, '__tests__', 'fixtures', 'job-posting-eu.json'), 'utf-8'),
)

const FRAMEWORK: FrameworkLike = {
  segments: [
    {
      id: 'seg-eng',
      name: 'Engineering Leaders',
      priority: 'primary',
      targetRoles: ['VP Engineering', 'Head of Engineering', 'CTO'],
      keyDecisionMakers: ['VP Engineering'],
    },
    {
      id: 'seg-prod',
      name: 'Product Leaders',
      priority: 'secondary',
      targetRoles: ['Director of Product', 'VP Product', 'Head of Product'],
      keyDecisionMakers: ['Director of Product'],
    },
  ],
}

function makeFiberResults(): FiberResult[] {
  return [
    {
      firstname: 'Ada',
      lastname: 'Lovelace',
      linkedin_url: 'https://linkedin.com/in/adalovelace',
      company: 'Anthropic',
      title: 'VP Engineering',
      email: null,
    },
  ]
}

function makeEnrichResults(opts: { withPhone: boolean }): FullenrichResult[] {
  return [
    {
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@anthropic.com',
      email_status: 'verified',
      phone: opts.withPhone ? '+14155550100' : null,
    },
  ]
}

interface SpyCounts {
  contactUpsert: number
  attachNote: number
  associateNoteToContact: number
  createTask: number
  sendSlack: number
  qualify: number
  peopleSearch: number
  peopleEnrich: number
  approve: number
  writeDryrun: number
}

function makeDeps(opts: {
  now: Date
  approve: boolean
  fiberResults?: FiberResult[]
  enrichResults?: FullenrichResult[]
  opener?: string
  spy: SpyCounts
  capturedDryrun?: (path: string, payload: DryrunPayload) => void
  associate?: { associated: boolean } | (() => Promise<{ associated: boolean }>)
  operatorTimezone?: string
}): Deps {
  return {
    now: () => opts.now,
    loadFramework: async () => FRAMEWORK,
    qualify: async () => {
      opts.spy.qualify++
      return { verdict: 'pass', failed_gate: null }
    },
    peopleSearch: async () => {
      opts.spy.peopleSearch++
      return { results: opts.fiberResults ?? makeFiberResults() }
    },
    peopleEnrich: async () => {
      opts.spy.peopleEnrich++
      return { results: opts.enrichResults ?? makeEnrichResults({ withPhone: true }) }
    },
    draftOpener: async () => opts.opener ?? 'Hello Ada, noticed the VP Engineering opening at Anthropic, calling with one pattern from scaling teams.',
    contactUpsert: async () => {
      opts.spy.contactUpsert++
      return { contactId: 'hs_contact_1' }
    },
    attachNote: async () => {
      opts.spy.attachNote++
      return { noteId: 'hs_note_1' }
    },
    associateNoteToContact: async () => {
      opts.spy.associateNoteToContact++
      if (typeof opts.associate === 'function') return opts.associate()
      return opts.associate ?? { associated: true }
    },
    createTask: async () => {
      opts.spy.createTask++
      return { taskId: 'hs_task_1' }
    },
    sendSlack: async () => {
      opts.spy.sendSlack++
    },
    approve: async (prompt: string) => {
      opts.spy.approve++
      expect(prompt).toBe(APPROVAL_PROMPT)
      return opts.approve
    },
    writeDryrun: (path: string, payload: DryrunPayload) => {
      opts.spy.writeDryrun++
      if (opts.capturedDryrun) opts.capturedDryrun(path, payload)
    },
    operatorTimezone: () => opts.operatorTimezone ?? 'UTC',
  }
}

function freshSpy(): SpyCounts {
  return {
    contactUpsert: 0,
    attachNote: 0,
    associateNoteToContact: 0,
    createTask: 0,
    sendSlack: 0,
    qualify: 0,
    peopleSearch: 0,
    peopleEnrich: 0,
    approve: 0,
    writeDryrun: 0,
  }
}

describe('signal-to-call skill', () => {
  it('SKILL.md exists with frontmatter v1.0.0', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw).toMatch(/^name:\s*signal-to-call\s*$/m)
    expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
  })

  it('description includes all 5 trigger phrases', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    for (const p of TRIGGER_PHRASES) expect(raw).toContain(`'${p}'`)
  })

  it('references/executive-resolution.md exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'executive-resolution.md'))).toBe(true)
  })

  it('SKILL.md contains no em-dash or en-dash characters', () => {
    const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
    expect(raw.includes('—')).toBe(false)
    expect(raw.includes('–')).toBe(false)
  })
})

describe('signal-to-call orchestrator', () => {
  let spy: SpyCounts
  beforeEach(() => {
    spy = freshSpy()
  })

  it('seniority derivation maps VP/Director/IC correctly', () => {
    expect(deriveSeniority('VP Engineering')).toBe('executive')
    expect(deriveSeniority('Director of Product')).toBe('manager')
    expect(deriveSeniority('Manager, Demand Gen')).toBe('manager')
    expect(deriveSeniority('Account Executive')).toBe('ic')
  })

  it('persona resolution finds the exact match first', () => {
    const persona = resolvePersona('VP Engineering', FRAMEWORK)
    expect(persona?.segment_id).toBe('seg-eng')
  })

  it('persona resolution returns null on no match', () => {
    const persona = resolvePersona('Senior Forklift Operator', FRAMEWORK)
    expect(persona).toBeNull()
  })

  it('dueAt during US daytime returns now + 12 hours (no shift)', () => {
    // Mon 2026-06-08 14:00 UTC = Mon 10:00 ET (EDT, UTC-4). Daytime weekday.
    const now = new Date('2026-06-08T14:00:00Z')
    const due = computeDueAt(now, 'US')
    expect(due.iso).toBe('2026-06-09T02:00:00.000Z')
    expect(new Date(due.iso).getTime() - now.getTime()).toBe(12 * 60 * 60 * 1000)
  })

  it('dueAt during US evening picks min(now+12h, next-day 09:00 local)', () => {
    // Tue 2026-06-09 23:00 UTC = Tue 19:00 ET. Evening (18-21).
    // 12h ceiling = Wed 11:00 UTC = Wed 07:00 ET.
    // Next-day 09:00 ET = Wed 13:00 UTC. Ceiling wins.
    const now = new Date('2026-06-09T23:00:00Z')
    const due = computeDueAt(now, 'US')
    expect(due.iso).toBe('2026-06-10T11:00:00.000Z')
  })

  it('dueAt overnight US shifts to next business morning 09:00 local', () => {
    // Wed 2026-06-10 03:00 UTC = Tue 23:00 ET. Overnight (21-06).
    // Next-day 09:00 ET = Wed 13:00 UTC.
    const now = new Date('2026-06-10T03:00:00Z')
    const due = computeDueAt(now, 'US')
    expect(due.iso).toBe('2026-06-10T13:00:00.000Z')
  })

  it('dueAt Friday late shifts to Monday 09:00 local for US prospect', () => {
    // Sat 2026-06-13 03:00 UTC = Fri 23:00 ET. Friday overnight.
    // Next biz morning = Mon 2026-06-15 09:00 ET = Mon 13:00 UTC.
    const now = new Date('2026-06-13T03:00:00Z')
    const due = computeDueAt(now, 'US')
    expect(due.iso).toBe('2026-06-15T13:00:00.000Z')
  })

  it('dueAt during DE daytime returns now + 12 hours (no shift)', () => {
    // Wed 2026-06-10 12:00 UTC = Wed 14:00 CEST (UTC+2 in June). Daytime weekday.
    const now = new Date('2026-06-10T12:00:00Z')
    const due = computeDueAt(now, 'DE')
    expect(due.iso).toBe('2026-06-11T00:00:00.000Z')
    expect(new Date(due.iso).getTime() - now.getTime()).toBe(12 * 60 * 60 * 1000)
  })

  it('dueAt on a weekend shifts to Monday 09:00 local', () => {
    // Sat 2026-06-13 17:00 UTC = Sat 13:00 ET. Weekend.
    // Next biz morning = Mon 2026-06-15 09:00 ET = Mon 13:00 UTC.
    const now = new Date('2026-06-13T17:00:00Z')
    const due = computeDueAt(now, 'US')
    expect(due.iso).toBe('2026-06-15T13:00:00.000Z')
  })

  it('extractCountryCode parses trailing tokens and bare codes', () => {
    expect(extractCountryCode('San Francisco, US')).toBe('US')
    expect(extractCountryCode('Berlin, Germany')).toBe('GERMANY')
    expect(extractCountryCode('Mars')).toBeNull()
    expect(extractCountryCode(undefined)).toBeNull()
  })

  it('timezoneForCountry maps the documented set', () => {
    expect(timezoneForCountry('US')).toBe('America/New_York')
    expect(timezoneForCountry('DE')).toBe('Europe/Berlin')
    expect(timezoneForCountry('GERMANY')).toBe('Europe/Berlin')
    expect(timezoneForCountry(undefined)).toBe('America/New_York')
  })

  it('dash-scan validator rejects an em-dash opener', () => {
    expect(validateOpener('Hello Ada — noticed the role.')).toBe(false)
    expect(validateOpener('Hello Ada – noticed the role.')).toBe(false)
    expect(validateOpener('Hello Ada - noticed the role.')).toBe(false)
    expect(validateOpener('Hello Ada, noticed the role.')).toBe(true)
  })

  it('writes dryrun JSON BEFORE any side effect, and halts on abort', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    let capturedPath = ''
    let capturedPayload: DryrunPayload | null = null
    const deps = makeDeps({
      now,
      approve: false,
      spy,
      capturedDryrun: (p, payload) => {
        capturedPath = p
        capturedPayload = payload
      },
    })

    const result = await runSignalToCall(FIXTURE_US, deps)

    // Dryrun written, but no HubSpot or Slack call.
    expect(spy.writeDryrun).toBe(1)
    expect(spy.approve).toBe(1)
    expect(spy.contactUpsert).toBe(0)
    expect(spy.attachNote).toBe(0)
    expect(spy.createTask).toBe(0)
    expect(spy.sendSlack).toBe(0)
    expect(result.pushed).toBe(false)
    expect(capturedPath).toContain('signal-to-call')
    expect(capturedPath).toContain('dryrun-')
    expect(capturedPayload).not.toBeNull()
    // 2026-06-07 12:00 UTC = Sun 08:00 ET. Weekend -> shift to next
    // business morning Mon 09:00 ET = 2026-06-08T13:00Z.
    expect(capturedPayload!.task.due_at_iso).toBe('2026-06-08T13:00:00.000Z')
  })

  it('on approve, each side-effect runs exactly once including note association', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    const deps = makeDeps({ now, approve: true, spy })

    const result = await runSignalToCall(FIXTURE_US, deps)

    expect(spy.contactUpsert).toBe(1)
    expect(spy.attachNote).toBe(1)
    expect(spy.associateNoteToContact).toBe(1)
    expect(spy.createTask).toBe(1)
    expect(spy.sendSlack).toBe(1)
    expect(result.pushed).toBe(true)
    expect(result.contactId).toBe('hs_contact_1')
    expect(result.taskId).toBe('hs_task_1')
    expect(result.noteAssociated).toBe(true)
    // Sunday 12:00 UTC = Sunday 08:00 ET. Weekend -> next business
    // morning Mon 09:00 ET = 2026-06-08T13:00:00Z.
    expect(result.dryrun.task.due_at_iso).toBe('2026-06-08T13:00:00.000Z')
  })

  it('when association call fails, skill still pushes task and DMs the operator', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    const deps = makeDeps({
      now,
      approve: true,
      spy,
      associate: { associated: false },
    })

    const result = await runSignalToCall(FIXTURE_US, deps)

    expect(result.pushed).toBe(true)
    expect(result.noteAssociated).toBe(false)
    // One Slack DM for the association failure, one for the ready event.
    expect(spy.sendSlack).toBe(2)
    expect(spy.createTask).toBe(1)
  })

  it('when association call throws, skill still pushes task and DMs the operator', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    const deps = makeDeps({
      now,
      approve: true,
      spy,
      associate: async () => {
        throw new Error('hubspot 500')
      },
    })

    const result = await runSignalToCall(FIXTURE_US, deps)

    expect(result.pushed).toBe(true)
    expect(result.noteAssociated).toBe(false)
    expect(spy.sendSlack).toBe(2)
    expect(spy.createTask).toBe(1)
  })

  it('EU prospect: Fiber returns 0 phones, email-only payload with documented reason', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    let captured: DryrunPayload | null = null
    const deps = makeDeps({
      now,
      approve: true,
      enrichResults: makeEnrichResults({ withPhone: false }),
      fiberResults: [
        {
          firstname: 'Marie',
          lastname: 'Curie',
          linkedin_url: 'https://linkedin.com/in/mariecurie',
          company: 'Mistral',
          title: 'Director of Product',
        },
      ],
      opener: 'Hello Marie, noticed the Director of Product opening at Mistral, calling with one observation about EU product rollouts.',
      spy,
      capturedDryrun: (_p, payload) => {
        captured = payload
      },
    })

    const result = await runSignalToCall(FIXTURE_EU, deps)

    expect(result.pushed).toBe(true)
    expect(captured).not.toBeNull()
    expect(captured!.contact.phone).toBeNull()
    expect(captured!.contact.phone_unavailable_reason).toBe('fiber_eu_coverage_gap')
    expect(captured!.contact.email).toBe('ada@anthropic.com')
    expect(captured!.task.subject).toMatch(/^Email Marie/)
    // Slack DM still went out (DM, not skipped).
    expect(spy.sendSlack).toBe(1)
  })

  it('opener with em-dash that survives both attempts halts with opener_failed_validation', async () => {
    const now = new Date('2026-06-07T12:00:00Z')
    const deps = makeDeps({
      now,
      approve: true,
      opener: 'Hello Ada — noticed the role at Anthropic.',
      spy,
    })

    await expect(runSignalToCall(FIXTURE_US, deps)).rejects.toMatchObject({
      name: 'SkillHalt',
      code: 'opener_failed_validation',
    })
    expect(spy.contactUpsert).toBe(0)
  })
})
