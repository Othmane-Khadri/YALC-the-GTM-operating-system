import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { findFramework } from '../lib/frameworks/loader'
import { runFramework } from '../lib/frameworks/runner'
import { saveInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import { writeApproved } from '../lib/frameworks/gates'
import { runFrameworkResume } from '../cli/commands/framework'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

function makeStubSkill(id: string, payload: unknown): Skill {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: `stub for ${id}`,
    category: 'outreach',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute() {
      yield { type: 'result', data: payload }
    },
  }
}

describe('archetype C — outreach-campaign-builder', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-archC-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('loads as on-demand (no cron) and pauses at the first human gate', async () => {
    const fw = findFramework('outreach-campaign-builder')
    expect(fw).not.toBeNull()
    expect(fw!.mode).toBe('on-demand')
    expect(fw!.schedule.cron).toBeUndefined()

    const cfg: InstalledFrameworkConfig = {
      name: 'outreach-campaign-builder',
      display_name: fw!.display_name,
      description: fw!.description,
      installed_at: new Date().toISOString(),
      schedule: {},
      output: { destination: 'dashboard', dashboard_route: '/frameworks/outreach-campaign-builder' },
      inputs: {
        hypothesis: 'Series A founders want SDR-replacement agents.',
        channel: 'linkedin',
        industry: 'SaaS',
        location: 'US',
        lead_limit: 5,
        account_id: 'acct_test',
      },
    }
    saveInstalledConfig(cfg)

    const reg = getSkillRegistry()
    reg.register(makeStubSkill('propose-campaigns', { variants: [{ id: 'v1', angle: 'CAC' }] }))
    reg.register(makeStubSkill('icp-company-search', { companies: [{ name: 'Acme' }] }))
    reg.register(makeStubSkill('people-enrich', { results: [{ email: 'jane@acme.com' }] }))
    reg.register(makeStubSkill('verify-campaign-launch', { ready: true, issues: [] }))
    reg.register(makeStubSkill('linkedin-campaign-create', { campaignId: 'c1', status: 'started' }))

    let pauseError: unknown = null
    try {
      await runFramework('outreach-campaign-builder')
    } catch (err) {
      pauseError = err
    }
    expect((pauseError as { name?: string })?.name).toBe('FrameworkGatePauseError')

    const runsDir = join(tempHome, '.gtm-os', 'agents', 'outreach-campaign-builder.runs')
    const files = readdirSync(runsDir).filter((f) => f.endsWith('.awaiting-gate.json'))
    expect(files.length).toBeGreaterThan(0)
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    expect(data.gate_id).toBe('pick-variant')

    // Approve the first gate via the canonical sentinel-writing helper, then
    // resume — the second gate (verify-and-launch) should now block.
    const runId = data.run_id
    writeApproved('outreach-campaign-builder', runId)
    let secondResumeErr: unknown = null
    try {
      await runFrameworkResume('outreach-campaign-builder', { fromGate: runId })
    } catch (err) {
      secondResumeErr = err
    }
    expect((secondResumeErr as { name?: string })?.name).toBe('FrameworkGatePauseError')
    expect((secondResumeErr as { gateId?: string })?.gateId).toBe('verify-and-launch')
  })
})
