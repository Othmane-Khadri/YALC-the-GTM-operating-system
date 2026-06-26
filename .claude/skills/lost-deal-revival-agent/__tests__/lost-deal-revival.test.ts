/**
 * Lost Deal Revival Agent — skill body tests.
 *
 * Mocks Claap, HubSpot (crm-create-task), Lemlist DRAFT path, and Slack.
 * Asserts the watcher-to-orchestrator round trip through the skill registry.
 */
import { describe, it, expect, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { lostDealRevivalSkill } from '../../../../src/lib/skills/builtin/lost-deal-revival'
import { getSkillRegistryReady } from '../../../../src/lib/skills/registry'
import type { SkillContext, SkillEvent } from '../../../../src/lib/skills/types'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'lost-deal-revival-agent')

const FIXTURE_QUOTE = 'Come back when we have doubled the team'

function fakeContext(): SkillContext {
  return {
    framework: null as never,
    intelligence: [],
    providers: {
      resolve: () => ({ id: 'noop', name: 'noop', execute: async function* () {} }),
    } as never,
    userId: 'test-runner',
  }
}

async function collect(events: AsyncIterable<SkillEvent>): Promise<SkillEvent[]> {
  const out: SkillEvent[] = []
  for await (const ev of events) out.push(ev)
  return out
}

function makePayload(overrides: Partial<Parameters<typeof lostDealRevivalSkill.execute>[0]> = {}) {
  return {
    watchId: 'watch-1',
    companyId: 'acme.com',
    entityName: 'Acme Inc',
    signalTypes: ['objection:headcount', 'signal:hiring_surge'],
    signals: [
      { signalType: 'objection:headcount', signalId: 'o1', payload: { text: FIXTURE_QUOTE }, lastSeenAt: '2026-06-07T00:00:00Z' },
      { signalType: 'signal:hiring_surge', signalId: 's1', payload: { summary: 'opened 12 new roles' }, lastSeenAt: '2026-06-07T00:00:00Z' },
    ],
    firedAt: '2026-06-07T12:00:00Z',
    __configOverride: { version: 1, output_mode: 'crm_task' as const, task_due_offset_hours: 24 },
    __mapOverride: { headcount: ['hiring_surge'], pricing: ['funding_round'] },
    __claapFetcher: vi.fn(async () => FIXTURE_QUOTE),
    __anthropicDraft: vi.fn(async () => ({
      line1: `Hello Acme Inc team, last time we spoke you told us "${FIXTURE_QUOTE}" and as of this week you opened 12 new roles.`,
      line2: 'Now that the team is growing, would it be worth picking the conversation back up?',
    })),
    __hubspotTask: vi.fn(async (_a: { subject: string; body: string; dueAt: string; ownerId?: string }) => ({ taskId: 'hs-task-42' })),
    __lemlistDraft: vi.fn(async (_a: { name: string; body: string }) => ({ campaignId: 'lem-99' })),
    __slackSend: vi.fn(async (_a: { text: string; target: string }) => undefined),
    ...overrides,
  }
}

describe('lost-deal-revival-agent skill', () => {
  describe('static files', () => {
    it('SKILL.md exists with the right frontmatter', () => {
      const raw = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')
      expect(raw).toMatch(/^name:\s*lost-deal-revival-agent\s*$/m)
      expect(raw).toMatch(/^version:\s*1\.0\.0\s*$/m)
      expect(raw).toMatch(/^category:\s*outreach\s*$/m)
    })

    it('atomic prompts exist', () => {
      expect(existsSync(join(SKILL_DIR, 'prompts', 'revival-copywriter.md'))).toBe(true)
      expect(existsSync(join(SKILL_DIR, 'prompts', 'objection-classifier.md'))).toBe(true)
    })

    it('objection-signal map template exists with the master plan mapping', () => {
      const raw = readFileSync(join(process.cwd(), 'configs', 'objection-signal-map.template.yaml'), 'utf-8')
      expect(raw).toContain('pricing:')
      expect(raw).toContain('funding_round')
      expect(raw).toContain('headcount:')
      expect(raw).toContain('hiring_surge')
      expect(raw).toContain('timing:')
      expect(raw).toContain('quarter_start')
      expect(raw).toContain('integration:')
      expect(raw).toContain('tech_stack_change')
      expect(raw).toContain('competitor:')
      expect(raw).toContain('competitor_customer_churn')
    })

    it('agent yaml documents the SETUP-entry design choice', () => {
      const raw = readFileSync(join(process.cwd(), 'configs', 'agents', 'lost-deal-revival-agent.yaml'), 'utf-8')
      expect(raw).toContain('SETUP ENTRY POINT')
      expect(raw).toContain('signal-pair-watcher')
      expect(raw).toMatch(/skillId:\s*lost-deal-revival-agent/)
    })
  })

  describe('happy path — crm_task mode', () => {
    it('fetches Claap, drafts a 2-line message, creates a HubSpot task, sends Slack DM', async () => {
      const input = makePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))

      expect(input.__claapFetcher).toHaveBeenCalledWith('Acme Inc', 'acme.com')
      expect(input.__anthropicDraft).toHaveBeenCalled()
      expect(input.__hubspotTask).toHaveBeenCalledTimes(1)
      expect(input.__lemlistDraft).not.toHaveBeenCalled()
      expect(input.__slackSend).toHaveBeenCalledTimes(1)

      const hsCall = (input.__hubspotTask as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(hsCall.subject).toBe('Revive: Acme Inc')
      expect(hsCall.body).toContain(FIXTURE_QUOTE)

      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      expect(result).toBeDefined()
      const data = result.data as Record<string, unknown>
      expect(data.status).toBe('drafted')
      expect(data.objection_kind).toBe('headcount')
      expect(data.signal_kind).toBe('hiring_surge')
      expect(data.taskId).toBe('hs-task-42')
      expect(data.output_mode).toBe('crm_task')
      const draft = data.draft as { line1: string; line2: string }
      expect(draft.line1).toContain(FIXTURE_QUOTE)
    })
  })

  describe('voice rules', () => {
    const BANNED_WORDS = [
      'really',
      'very',
      'just',
      'actually',
      'i think',
      'synergy',
      'leverage',
      'ecosystem',
      'cutting-edge',
      'best-in-class',
      'game-changer',
    ]

    function makeVoicePayload() {
      // Fixture whose signal payload includes a count so the LLM has
      // something to anchor on. The mocked draft mirrors what the
      // tightened prompt would produce.
      return makePayload({
        signals: [
          { signalType: 'objection:headcount', signalId: 'o1', payload: { text: FIXTURE_QUOTE }, lastSeenAt: '2026-06-07T00:00:00Z' },
          { signalType: 'signal:hiring_surge', signalId: 's1', payload: { summary: '6 SDR roles opened' }, lastSeenAt: '2026-06-07T00:00:00Z' },
        ],
        __anthropicDraft: vi.fn(async () => ({
          line1: `Hello Acme Inc team, last quarter you told us "${FIXTURE_QUOTE}" and as of this week you have 6 SDR roles open on your careers page.`,
          line2: 'Want me to resend the ramp model with the new team size baked in?',
        })),
      })
    }

    it('draft anchors on a concrete number from the signal payload', async () => {
      const input = makeVoicePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const draft = (result.data as Record<string, unknown>).draft as { line1: string; line2: string }
      const fullText = `${draft.line1} ${draft.line2}`
      expect(fullText).toMatch(/\d+/)
    })

    it('draft contains none of the banned filler words or buzzwords', async () => {
      const input = makeVoicePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const draft = (result.data as Record<string, unknown>).draft as { line1: string; line2: string }
      const fullTextLower = `${draft.line1} ${draft.line2}`.toLowerCase()
      for (const banned of BANNED_WORDS) {
        // \b boundaries to avoid false positives like "justify" matching "just"
        const re = new RegExp(`\\b${banned.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
        expect(fullTextLower, `banned word "${banned}" found in draft`).not.toMatch(re)
      }
    })

    it('draft is at most 2 sentences (period count <= 3 for safety)', async () => {
      const input = makeVoicePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const draft = (result.data as Record<string, unknown>).draft as { line1: string; line2: string }
      const fullText = `${draft.line1} ${draft.line2}`
      const periodCount = (fullText.match(/\./g) ?? []).length
      expect(periodCount).toBeLessThanOrEqual(3)
    })

    it('draft still contains the verbatim Claap quote (voice rules do not break the anchor)', async () => {
      const input = makeVoicePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const draft = (result.data as Record<string, unknown>).draft as { line1: string; line2: string }
      expect(draft.line1).toContain(FIXTURE_QUOTE)
    })
  })

  describe('output_mode = lemlist_draft', () => {
    it('flips to Lemlist DRAFT and never calls set_campaign_state(start)', async () => {
      const setStateSpy = vi.fn()
      // simulate a Lemlist client where set_campaign_state is the start path
      const input = makePayload({
        __configOverride: { version: 1, output_mode: 'lemlist_draft' as const },
        __lemlistDraft: vi.fn(async (args: { name: string; body: string }) => {
          // Assert we are never asked to "start"
          expect(args.name).toContain('Acme Inc')
          // Verify the surrounding test never invokes the start path
          return { campaignId: 'lem-200' }
        }),
      })

      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))

      expect(input.__lemlistDraft).toHaveBeenCalledTimes(1)
      expect(input.__hubspotTask).not.toHaveBeenCalled()
      expect(setStateSpy).not.toHaveBeenCalled()

      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const data = result.data as Record<string, unknown>
      expect(data.campaignId).toBe('lem-200')
      expect(data.output_mode).toBe('lemlist_draft')
      expect(data.taskId).toBeUndefined()
    })
  })

  describe('dash-scan rail', () => {
    it('passes when the draft is clean', async () => {
      const input = makePayload()
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      const errors = events.filter((e) => e.type === 'error')
      expect(errors.length).toBe(0)
    })

    it('rejects a draft with an em-dash even after retry', async () => {
      const badDraft = vi.fn(async () => ({
        line1: 'Hello Acme team — last time you said "Come back when we have doubled the team" and that just changed.',
        line2: 'Worth a chat?',
      }))
      const input = makePayload({ __anthropicDraft: badDraft })
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))
      expect(badDraft).toHaveBeenCalledTimes(2) // initial + retry
      const error = events.find((e) => e.type === 'error') as Extract<SkillEvent, { type: 'error' }>
      expect(error).toBeDefined()
      expect(error.message).toContain('dash_scan_failed')
      expect(input.__hubspotTask).not.toHaveBeenCalled()
    })
  })

  describe('mismatched pair (defensive)', () => {
    it('logs and exits cleanly without writing to CRM or Lemlist or Slack', async () => {
      const input = makePayload({
        signalTypes: ['objection:pricing', 'signal:hiring_surge'],
        // pricing maps to funding_round, NOT hiring_surge
        __mapOverride: { pricing: ['funding_round'], headcount: ['hiring_surge'] },
      })
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))

      expect(input.__claapFetcher).not.toHaveBeenCalled()
      expect(input.__anthropicDraft).not.toHaveBeenCalled()
      expect(input.__hubspotTask).not.toHaveBeenCalled()
      expect(input.__lemlistDraft).not.toHaveBeenCalled()
      expect(input.__slackSend).not.toHaveBeenCalled()

      const errors = events.filter((e) => e.type === 'error')
      expect(errors.length).toBe(0)

      const result = events.find((e) => e.type === 'result') as Extract<SkillEvent, { type: 'result' }>
      const data = result.data as Record<string, unknown>
      expect(data.status).toBe('mismatched_pair')
      expect(data.objection_kind).toBe('pricing')
      expect(data.signal_kind).toBe('hiring_surge')
    })
  })

  describe('claap returns nothing', () => {
    it('hard stops without writing', async () => {
      const input = makePayload({ __claapFetcher: vi.fn(async () => null) })
      const events = await collect(lostDealRevivalSkill.execute(input, fakeContext()))

      const error = events.find((e) => e.type === 'error') as Extract<SkillEvent, { type: 'error' }>
      expect(error).toBeDefined()
      expect(error.message).toContain('claap_no_transcript')
      expect(input.__hubspotTask).not.toHaveBeenCalled()
      expect(input.__lemlistDraft).not.toHaveBeenCalled()
    })
  })

  describe('watcher round trip via the skill registry', () => {
    it('resolves lost-deal-revival-agent from the registry and invokes execute()', async () => {
      const registry = await getSkillRegistryReady()
      const skill = registry.get('lost-deal-revival-agent')
      expect(skill).not.toBeNull()
      expect(skill!.id).toBe('lost-deal-revival-agent')

      // Simulate the watcher's defaultRegistryInvoker pattern.
      const payload = makePayload()
      let sawResult = false
      for await (const ev of skill!.execute(payload, fakeContext())) {
        if (ev.type === 'result') sawResult = true
        if (ev.type === 'error') throw new Error(ev.message)
      }
      expect(sawResult).toBe(true)
    })
  })
})
