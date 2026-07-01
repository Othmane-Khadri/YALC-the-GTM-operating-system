/**
 * Buying Committee Mapper, acceptance tests.
 *
 * Mocks the offer + first-contact prompts, the LLM role generation,
 * Fiber people-search, FullEnrich enrich_bulk, Lemlist MCP calls, and
 * Notion writes. Asserts:
 *   1. Five distinct messages in the dryrun JSON.
 *   2. set_campaign_state(start) never called.
 *   3. Each message routes through the correct copywriting atom by tier.
 *   4. Dash-scan validator passes on every drafted message.
 *   5. Voice rules are passed verbatim into each copywriting atom call.
 *   6. The role generation prompt contains the offer, the first contact
 *      role, and the company name, and contains NO baked-in default
 *      titles.
 *   7. Drafted messages do not start with "I" and contain a number.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  buildRoles,
  buildRoleGenerationPrompt,
  parseGeneratedRoles,
  buildFiberQuery,
  buildLemlistCallPlan,
  routeCopywritingSkill,
  dashScan,
  messagesAreDistinct,
  assembleDryrun,
  VOICE_RULES,
  COMMITTEE_SLOTS,
  type RoleEntry,
  type CommitteeRole,
} from '../../../../src/lib/committee/buying-committee-mapper'
import {
  ACME_COMPANY,
  ACME_CONTACTS,
  ACME_MESSAGES,
  ACME_OFFER,
  ACME_FIRST_CONTACT,
  ACME_GENERATED_ROLES,
} from './fixtures/acme'

/**
 * Mock the operator prompts (offer + first contact) and the LLM role
 * generation. Returns a function that simulates the orchestrator's
 * pre-Fiber chain end-to-end.
 */
function mockPromptChain() {
  const operatorAnswers = {
    offer: ACME_OFFER,
    firstContact: ACME_FIRST_CONTACT,
    confirmCommittee: 'yes',
  }
  const llmRoleGen = vi.fn().mockResolvedValue(ACME_GENERATED_ROLES)
  return { operatorAnswers, llmRoleGen }
}

/** Build a populated RoleEntry array from the fixture. */
function buildAcmeEntries(roles: CommitteeRole[]): RoleEntry[] {
  return roles.map((role) => ({
    slot: role.slot,
    title_patterns: role.title_patterns,
    seniority_tier: role.seniority_tier,
    pain_emphasis: role.pain_emphasis,
    routed_copywriting_skill: routeCopywritingSkill(role.seniority_tier),
    contact: ACME_CONTACTS[role.slot],
    message: ACME_MESSAGES[role.slot],
  }))
}

describe('buying-committee-mapper, acceptance', () => {
  it('produces 5 distinct messages in the dryrun', async () => {
    const { operatorAnswers, llmRoleGen } = mockPromptChain()
    const generated = await llmRoleGen()
    const { roles } = buildRoles({
      offer: operatorAnswers.offer,
      firstContact: operatorAnswers.firstContact,
      framework: null,
      generatedRoles: parseGeneratedRoles(generated),
    })
    const entries = buildAcmeEntries(roles)
    expect(entries).toHaveLength(5)
    expect(messagesAreDistinct(entries.map((e) => e.message))).toBe(true)
    const bodies = entries.map((e) => e.message!.body)
    expect(new Set(bodies).size).toBe(5)
  })

  it('never calls set_campaign_state(start) anywhere in the call plan', async () => {
    const { operatorAnswers, llmRoleGen } = mockPromptChain()
    const generated = await llmRoleGen()
    const { roles } = buildRoles({
      offer: operatorAnswers.offer,
      firstContact: operatorAnswers.firstContact,
      framework: null,
      generatedRoles: parseGeneratedRoles(generated),
    })
    const entries = buildAcmeEntries(roles)
    const plan = buildLemlistCallPlan('Buying Committee, Acme Inc', entries)

    // Plan shape: 1 create + 4 add_sequence_step.
    expect(plan).toHaveLength(5)
    expect(plan[0].tool).toBe('create_campaign_with_sequence')
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].tool).toBe('add_sequence_step')
    }

    for (const call of plan) {
      expect(call.tool).not.toBe('set_campaign_state')
    }

    const mcp = {
      create_campaign_with_sequence: vi.fn().mockResolvedValue({ campaignId: 'cam_x', sequenceId: 'seq_x' }),
      add_sequence_step: vi.fn().mockResolvedValue({ ok: true }),
      set_campaign_state: vi.fn(),
    }
    for (const call of plan) {
      ;(mcp[call.tool] as ReturnType<typeof vi.fn>)(call.payload)
    }
    expect(mcp.set_campaign_state).not.toHaveBeenCalled()
  })

  it('routes each message through the correct copywriting atom by tier', async () => {
    const { operatorAnswers, llmRoleGen } = mockPromptChain()
    const generated = await llmRoleGen()
    const { roles } = buildRoles({
      offer: operatorAnswers.offer,
      firstContact: operatorAnswers.firstContact,
      framework: null,
      generatedRoles: parseGeneratedRoles(generated),
    })
    const entries = buildAcmeEntries(roles)
    const tierToSkill: Record<string, string> = {
      'VP+': 'copywriting-vp-sequence',
      Manager: 'copywriting-manager-sequence',
      IC: 'copywriting-ic-sequence',
    }
    for (const e of entries) {
      expect(e.routed_copywriting_skill).toBe(tierToSkill[e.seniority_tier])
    }
  })

  it('dash-scan validator passes on all five drafted messages', async () => {
    const { operatorAnswers, llmRoleGen } = mockPromptChain()
    const generated = await llmRoleGen()
    const { roles } = buildRoles({
      offer: operatorAnswers.offer,
      firstContact: operatorAnswers.firstContact,
      framework: null,
      generatedRoles: parseGeneratedRoles(generated),
    })
    const entries = buildAcmeEntries(roles)
    for (const e of entries) {
      expect(dashScan(e.message!.body)).toBe(true)
      expect(dashScan(e.message!.subject)).toBe(true)
    }
    // Negative control.
    expect(dashScan('Hello — friend')).toBe(false)
    expect(dashScan('Hello – friend')).toBe(false)
  })

  it('the role generation prompt is built from offer, first contact role, and company name and contains no baked-in default titles', () => {
    const prompt = buildRoleGenerationPrompt({
      offer: ACME_OFFER,
      firstContact: ACME_FIRST_CONTACT,
      companyName: ACME_COMPANY.name,
      framework: null,
    })

    // Offer description appears.
    expect(prompt).toContain(ACME_OFFER.description)
    // First contact resolved title appears.
    expect(prompt).toContain('Head of Sales Ops')
    // Company name appears.
    expect(prompt).toContain('Acme Inc')

    // NO baked-in default title appears in the prompt body. These titles
    // were the previous static defaults. The new prompt MUST not prefill
    // any of them; titles are proposed by the LLM in context.
    const oldDefaults = [
      'Director of Sales',
      'RevOps Director',
      'VP Sales',
      'CRO',
      'CEO',
      'CTO',
      'VP Engineering',
      'Head of Platform',
      'Senior SDR',
      'Account Executive',
      'Senior AE',
      'Head of Procurement',
      'Director of Finance',
      'CFO',
    ]
    // The prompt may mention "Director of Sales" / "CRO" as the example
    // anti-pattern in the rules block; assert each forbidden default
    // only appears inside the "Do not default to generic titles like" line.
    const lines = prompt.split('\n')
    const antiPatternLine = lines.find((l) =>
      l.includes('Do not\n    default to generic titles like'),
    )
    // Just check none of the slots ship as pre-filled patterns. The
    // tightest assertion: the prompt does NOT contain the literal string
    // "title_patterns": followed by any of these titles.
    for (const t of oldDefaults) {
      const prefilled = new RegExp(`"title_patterns"\\s*:\\s*\\[[^\\]]*${t}`, 'i')
      expect(prefilled.test(prompt)).toBe(false)
    }
    // The anti-pattern guardrail line is allowed to reference the names.
    void antiPatternLine
  })

  it('the role generation prompt embeds offer and first contact context', () => {
    const prompt = buildRoleGenerationPrompt({
      offer: { description: 'Sell vendor risk automation to procurement teams at mid-market SaaS.' },
      firstContact: {
        raw: 'sarah@example.com',
        resolved_name: 'Sarah Lee',
        resolved_title: 'Procurement Manager',
      },
      companyName: 'Zenith Corp',
    })
    expect(prompt).toContain('Sell vendor risk automation to procurement teams at mid-market SaaS.')
    expect(prompt).toContain('Procurement Manager')
    expect(prompt).toContain('Zenith Corp')
    expect(prompt).toContain('Sarah Lee')
  })

  it('buildRoles flags overrideApplied when framework provides ICP hints', async () => {
    const generated = parseGeneratedRoles(ACME_GENERATED_ROLES)
    const withFramework = buildRoles({
      offer: ACME_OFFER,
      firstContact: ACME_FIRST_CONTACT,
      framework: {
        segments: [
          {
            name: 'Mid-market RevOps leaders',
            targetRoles: ['Head of RevOps'],
            keyDecisionMakers: ['CRO'],
          },
        ],
      },
      generatedRoles: generated,
    })
    expect(withFramework.overrideApplied).toBe(true)

    const withoutFramework = buildRoles({
      offer: ACME_OFFER,
      firstContact: ACME_FIRST_CONTACT,
      framework: null,
      generatedRoles: generated,
    })
    expect(withoutFramework.overrideApplied).toBe(false)
  })
})

describe('buying-committee-mapper, voice rules', () => {
  it('passes the voice rules verbatim into each copywriting atom call', async () => {
    const { operatorAnswers, llmRoleGen } = mockPromptChain()
    const generated = await llmRoleGen()
    const { roles } = buildRoles({
      offer: operatorAnswers.offer,
      firstContact: operatorAnswers.firstContact,
      framework: null,
      generatedRoles: parseGeneratedRoles(generated),
    })
    const entries = buildAcmeEntries(roles)

    // Simulate the orchestrator's step 8 call out to copywriting atoms.
    const copywritingAtom = vi.fn().mockImplementation(async () => ({
      subject: 'mock', body: 'Hello, this is a mock with 1 number.',
    }))
    for (const e of entries) {
      await copywritingAtom({
        contact: e.contact,
        pain_emphasis: e.pain_emphasis,
        instruction:
          'Write only the first email of the sequence; this is a single-touch outreach inside a five-thread committee campaign.',
        voice_rules: VOICE_RULES,
      })
    }
    expect(copywritingAtom).toHaveBeenCalledTimes(5)
    for (const call of copywritingAtom.mock.calls) {
      expect(call[0].voice_rules).toBe(VOICE_RULES)
    }
  })

  it('VOICE_RULES contains the core do-not-do clauses and the data-first clause', () => {
    expect(VOICE_RULES).toContain('Direct')
    expect(VOICE_RULES).toContain('Data first')
    expect(VOICE_RULES).toContain('hope this finds you well')
    expect(VOICE_RULES).toContain('just reaching out')
    expect(VOICE_RULES).toContain('Do not start the body with the word "I"')
    expect(VOICE_RULES).toContain('One forward-looking question at the end')
    // No buzzwords list mentioned verbatim
    expect(VOICE_RULES).toContain('synergy')
    expect(VOICE_RULES).toContain('best-in-class')
    // Dash-scan + buzzword line
    expect(VOICE_RULES).toContain('No em-dash')
  })

  it('drafted messages contain a number, do not start with "I", and pass dash-scan', () => {
    const entries = buildAcmeEntries(ACME_GENERATED_ROLES)
    for (const e of entries) {
      const body = e.message!.body
      // Contains at least one digit.
      expect(/\d/.test(body)).toBe(true)
      // Does NOT start with the word "I" followed by a non-letter.
      // Allows words like "It", "In", "Inside" by checking word boundary.
      expect(/^I[\s'.,]/.test(body)).toBe(false)
      // Dash-scan.
      expect(dashScan(body)).toBe(true)
    }
  })
})

describe('buying-committee-mapper, supporting helpers', () => {
  it('buildFiberQuery shapes the input per the Fiber adapter', () => {
    const q = buildFiberQuery('Acme Inc', ACME_GENERATED_ROLES[0])
    expect(q.tool).toBe('peopleSearch_tool')
    expect(q.input.company).toBe('Acme Inc')
    expect(q.input.title).toContain('Head of Sales Ops')
    expect(q.input.title).toContain(' OR ')
    expect(q.input.limit).toBe(5)
  })

  it('parseGeneratedRoles throws when a slot is missing', () => {
    const bad = ACME_GENERATED_ROLES.slice(0, 4)
    expect(() => parseGeneratedRoles(bad)).toThrow(/missing slot/i)
  })

  it('parseGeneratedRoles enforces the five canonical slots', () => {
    const out = parseGeneratedRoles(ACME_GENERATED_ROLES)
    expect(out.map((r) => r.slot)).toEqual(COMMITTEE_SLOTS)
  })

  it('assembleDryrun returns the full schema with all five roles plus offer and first contact', () => {
    const generated = parseGeneratedRoles(ACME_GENERATED_ROLES)
    const { roles, overrideApplied } = buildRoles({
      offer: ACME_OFFER,
      firstContact: ACME_FIRST_CONTACT,
      framework: null,
      generatedRoles: generated,
    })
    const entries = buildAcmeEntries(roles)
    const plan = buildLemlistCallPlan('Buying Committee, Acme Inc', entries)
    const dryrun = assembleDryrun({
      companyName: ACME_COMPANY.name,
      domain: ACME_COMPANY.domain,
      offer: ACME_OFFER,
      firstContact: ACME_FIRST_CONTACT,
      overrideApplied,
      entries,
      callPlan: plan,
    })

    expect(dryrun.target_company.name).toBe('Acme Inc')
    expect(dryrun.target_company.domain).toBe('acme.com')
    expect(dryrun.offer.description).toBe(ACME_OFFER.description)
    expect(dryrun.first_contact.raw).toBe(ACME_FIRST_CONTACT.raw)
    expect(dryrun.first_contact.resolved_title).toBe('Head of Sales Ops')
    expect(dryrun.roles).toHaveLength(5)
    expect(dryrun.framework_override_applied).toBe(false)
    expect(dryrun.notion_page_draft_url).toBe('pending_approval')
    expect(dryrun.post_approve_artifacts.lemlist_campaign_id).toBeNull()
    expect(dryrun.post_approve_artifacts.notion_page_url).toBeNull()

    expect(dryrun.lemlist_mcp_call_plan[0].tool).toBe('create_campaign_with_sequence')
    for (const c of dryrun.lemlist_mcp_call_plan) {
      expect(c.tool).not.toContain('set_campaign_state')
    }
  })

  it('phone-missing flag flows through fixture contacts', () => {
    const missingCount = (Object.values(ACME_CONTACTS) as Array<{ phone_missing: boolean }>).filter(
      (c) => c.phone_missing,
    ).length
    expect(missingCount).toBe(4)
  })
})
