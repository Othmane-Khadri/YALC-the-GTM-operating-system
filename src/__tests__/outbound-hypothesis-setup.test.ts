/**
 * A3 — outbound-hypothesis setup-completion step.
 *
 * Covers:
 *   1. setup.md contains a Step 10 that asks 4 hypothesis questions in order
 *      (ICP segment → message angle → signal trigger → expected reply rate),
 *      gates on having LinkedIn OR email keys, and never asks for content hooks.
 *   2. The Step 10 path with NO outbound channel keys shows skip-only message
 *      and does NOT install the framework.
 *   3. The hypothesis persistence helpers serialize the 4 sub-fields cleanly.
 *   4. `outreach-campaign-builder` first-run never calls the content-hook
 *      `propose-campaigns` skill before the hypothesis is captured.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string
let prevHome: string | undefined

beforeEach(() => {
  prevHome = process.env.HOME
  TMP = mkdtempSync(join(tmpdir(), 'yalc-a3-'))
  process.env.HOME = TMP
  delete process.env.UNIPILE_API_KEY
  delete process.env.UNIPILE_DSN
  delete process.env.INSTANTLY_API_KEY
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
})

afterEach(() => {
  process.env.HOME = prevHome
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

describe('A3 — setup.md Step 10 outbound-hypothesis prompt', () => {
  const setupMdPath = join(
    process.cwd().replace(/\/[^/]+$/, ''), // unused, just to be defensive
    '.claude/skills/setup/skills/setup.md',
  )

  it('setup.md contains Step 10 with the 4 hypothesis questions in order', () => {
    const repoRoot = process.cwd().replace(/\/$/, '')
    // process.cwd() during vitest is the repo root.
    const md = readFileSync(join(repoRoot, '.claude/skills/setup/skills/setup.md'), 'utf-8')
    expect(md).toMatch(/Step 10/)
    expect(md).toMatch(/Want to test an outbound hypothesis right now\?/)
    // The 4 questions, in order.
    const idxIcp = md.indexOf('ICP segment')
    const idxAngle = md.indexOf('Message angle')
    const idxSignal = md.indexOf('Signal')
    const idxReply = md.indexOf('Expected reply rate')
    expect(idxIcp).toBeGreaterThan(0)
    expect(idxAngle).toBeGreaterThan(idxIcp)
    expect(idxSignal).toBeGreaterThan(idxAngle)
    expect(idxReply).toBeGreaterThan(idxSignal)
    // The 4-questions block (Step 10.4) MUST NOT ask the user for content
    // hooks. Guardrail phrasing elsewhere ("never ask about content hooks")
    // is allowed since it's negative guidance, not a question to the user.
    const step10 = md.slice(md.indexOf('## Step 10'), md.indexOf('## Step 11'))
    const step10_4 = step10.slice(step10.indexOf('Step 10.4'), step10.indexOf('Step 10.5'))
    // Pull out only the four numbered questions inside Step 10.4 (lines that
    // start with `1.` / `2.` / `3.` / `4.` after the question header).
    const questionsBlock = step10_4
      .split('\n')
      .filter((l) => /^\d\. \*\*/.test(l.trim()))
      .join(' ')
      .toLowerCase()
    expect(questionsBlock).not.toContain('hook')
    expect(questionsBlock).not.toContain('content')
    expect(questionsBlock).toContain('icp segment')
    expect(questionsBlock).toContain('message angle')
    expect(questionsBlock).toContain('signal')
    expect(questionsBlock).toContain('expected reply rate')
    // Must reference framework:install for outreach-campaign-builder
    expect(step10).toContain('outreach-campaign-builder')
    expect(setupMdPath).toBeTruthy() // suppress unused
  })

  it('setup.md gates Step 10 on having LinkedIn OR email keys', () => {
    const repoRoot = process.cwd().replace(/\/$/, '')
    const md = readFileSync(join(repoRoot, '.claude/skills/setup/skills/setup.md'), 'utf-8')
    const step10 = md.slice(md.indexOf('## Step 10'), md.indexOf('## Step 11'))
    // Mentions both UNIPILE_API_KEY and INSTANTLY_API_KEY as gating conditions
    expect(step10).toMatch(/UNIPILE_API_KEY/)
    expect(step10).toMatch(/INSTANTLY_API_KEY/)
    // Has a skip path that mentions yalc-gtm keys:connect
    expect(step10).toMatch(/keys:connect/)
  })

  it('setup.md keeps the hand-off summary as the final step (Step 11)', () => {
    const repoRoot = process.cwd().replace(/\/$/, '')
    const md = readFileSync(join(repoRoot, '.claude/skills/setup/skills/setup.md'), 'utf-8')
    expect(md).toMatch(/Step 11/)
    // Hand-off summary content lives under Step 11 now.
    expect(md).toMatch(/Hand-off summary/)
  })
})

describe('A3 — outbound channel key detection', () => {
  it('detects LinkedIn keys (UNIPILE_API_KEY + UNIPILE_DSN)', async () => {
    const { hasOutboundChannelKeys } = await import('../lib/frameworks/outbound-hypothesis')
    delete process.env.UNIPILE_API_KEY
    delete process.env.UNIPILE_DSN
    delete process.env.INSTANTLY_API_KEY
    expect(hasOutboundChannelKeys()).toBe(false)

    process.env.UNIPILE_API_KEY = 'k'
    process.env.UNIPILE_DSN = 'dsn'
    expect(hasOutboundChannelKeys()).toBe(true)
  })

  it('detects email-only setup (INSTANTLY_API_KEY)', async () => {
    const { hasOutboundChannelKeys } = await import('../lib/frameworks/outbound-hypothesis')
    delete process.env.UNIPILE_API_KEY
    delete process.env.UNIPILE_DSN
    delete process.env.INSTANTLY_API_KEY
    expect(hasOutboundChannelKeys()).toBe(false)

    process.env.INSTANTLY_API_KEY = 'k'
    expect(hasOutboundChannelKeys()).toBe(true)
  })

  it('returns false when only LinkedIn key is half-set', async () => {
    const { hasOutboundChannelKeys } = await import('../lib/frameworks/outbound-hypothesis')
    delete process.env.UNIPILE_DSN
    delete process.env.INSTANTLY_API_KEY
    process.env.UNIPILE_API_KEY = 'k'
    expect(hasOutboundChannelKeys()).toBe(false)
  })
})

describe('A3 — hypothesis persistence', () => {
  it('saves and loads the 4 hypothesis sub-fields verbatim', async () => {
    const {
      saveOutboundHypothesis,
      loadOutboundHypothesis,
    } = await import('../lib/frameworks/outbound-hypothesis')
    const hyp = {
      icp_segment: 'Series A SaaS CTOs in EU',
      message_angle: 'We compress LLM eval cycles 10x for compliance teams',
      signal_trigger: 'Posted about SOC 2 / EU AI Act in last 30 days',
      expected_reply_rate: 0.06,
    }
    saveOutboundHypothesis('outreach-campaign-builder', hyp)
    const loaded = loadOutboundHypothesis('outreach-campaign-builder')
    expect(loaded).toEqual(hyp)
  })

  it('exposes the canonical 4-field shape on the campaign hypothesis record', async () => {
    const {
      saveOutboundHypothesis,
      loadOutboundHypothesis,
    } = await import('../lib/frameworks/outbound-hypothesis')
    saveOutboundHypothesis('outreach-campaign-builder', {
      icp_segment: 'A',
      message_angle: 'B',
      signal_trigger: 'C',
      expected_reply_rate: 0.05,
    })
    const loaded = loadOutboundHypothesis('outreach-campaign-builder')!
    expect(Object.keys(loaded).sort()).toEqual([
      'expected_reply_rate',
      'icp_segment',
      'message_angle',
      'signal_trigger',
    ])
  })

  it('rejects a hypothesis with missing fields', async () => {
    const { saveOutboundHypothesis } = await import('../lib/frameworks/outbound-hypothesis')
    expect(() =>
      // Missing message_angle, signal_trigger, expected_reply_rate.
      saveOutboundHypothesis('outreach-campaign-builder', { icp_segment: 'A' } as never),
    ).toThrow(/icp_segment|message_angle|signal_trigger|expected_reply_rate/)
  })

  it('rejects an out-of-range expected_reply_rate', async () => {
    const { saveOutboundHypothesis } = await import('../lib/frameworks/outbound-hypothesis')
    expect(() =>
      saveOutboundHypothesis('outreach-campaign-builder', {
        icp_segment: 'A',
        message_angle: 'B',
        signal_trigger: 'C',
        expected_reply_rate: 2.5, // > 1
      }),
    ).toThrow(/expected_reply_rate/)
  })

  it('persists the hypothesis on the InstalledFrameworkConfig.inputs.hypothesis slot too', async () => {
    const { saveInstalledConfig, loadInstalledConfig } = await import('../lib/frameworks/registry')
    const { saveOutboundHypothesis } = await import('../lib/frameworks/outbound-hypothesis')

    saveInstalledConfig({
      name: 'outreach-campaign-builder',
      display_name: 'Outreach Campaign Builder',
      description: 'desc',
      installed_at: '2026-04-30T00:00:00Z',
      schedule: {},
      output: { destination: 'dashboard' },
      inputs: {},
    })
    saveOutboundHypothesis('outreach-campaign-builder', {
      icp_segment: 'CTOs',
      message_angle: 'angle',
      signal_trigger: 'trigger',
      expected_reply_rate: 0.07,
    })
    const cfg = loadInstalledConfig('outreach-campaign-builder')!
    expect(cfg.inputs.hypothesis).toEqual({
      icp_segment: 'CTOs',
      message_angle: 'angle',
      signal_trigger: 'trigger',
      expected_reply_rate: 0.07,
    })
  })
})

describe('A3 — framework:set-hypothesis CLI command', () => {
  it('persists the 4-field hypothesis when called with all flags', async () => {
    const { runFrameworkSetHypothesis } = await import('../cli/commands/framework')
    const { loadOutboundHypothesis } = await import('../lib/frameworks/outbound-hypothesis')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await runFrameworkSetHypothesis('outreach-campaign-builder', {
        icpSegment: 'Series A SaaS CTOs',
        messageAngle: 'Compress LLM eval cycles 10x',
        signalTrigger: 'Posted about SOC 2 in last 30d',
        expectedReplyRate: '0.07',
      })
    } finally {
      logSpy.mockRestore()
    }
    const loaded = loadOutboundHypothesis('outreach-campaign-builder')
    expect(loaded).toEqual({
      icp_segment: 'Series A SaaS CTOs',
      message_angle: 'Compress LLM eval cycles 10x',
      signal_trigger: 'Posted about SOC 2 in last 30d',
      expected_reply_rate: 0.07,
    })
  })

  it('rejects a non-numeric expected-reply-rate via process.exit(1)', async () => {
    const { runFrameworkSetHypothesis } = await import('../cli/commands/framework')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit(${code})`)
    }) as never)
    try {
      await expect(
        runFrameworkSetHypothesis('outreach-campaign-builder', {
          icpSegment: 'A',
          messageAngle: 'B',
          signalTrigger: 'C',
          expectedReplyRate: 'not-a-number',
        }),
      ).rejects.toThrow(/process\.exit\(1\)/)
    } finally {
      errSpy.mockRestore()
      exitSpy.mockRestore()
    }
  })
})

describe('A3 — outreach-campaign-builder framework declaration', () => {
  it('does NOT declare the content-focused propose-campaigns skill as the first step', async () => {
    const { findFramework } = await import('../lib/frameworks/loader')
    const fw = findFramework('outreach-campaign-builder')
    expect(fw).not.toBeNull()
    // The first non-gate step must NOT be propose-campaigns (the content-hook skill).
    const firstSkillStep = fw!.steps.find(
      (s) => typeof s === 'object' && s !== null && 'skill' in s,
    ) as { skill: string } | undefined
    expect(firstSkillStep?.skill).not.toBe('propose-campaigns')
  })

  it('declares an `outbound-hypothesis-capture` first-run skill that asks the 4 questions', async () => {
    const { findFramework } = await import('../lib/frameworks/loader')
    const fw = findFramework('outreach-campaign-builder')!
    const skillNames = fw.steps
      .filter((s): s is { skill: string } => typeof s === 'object' && 'skill' in s)
      .map((s) => s.skill)
    expect(skillNames[0]).toBe('outbound-hypothesis-capture')
  })
})
