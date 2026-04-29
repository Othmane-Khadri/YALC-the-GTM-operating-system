import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { findFramework } from '../lib/frameworks/loader'
import { runFramework } from '../lib/frameworks/runner'
import { saveInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

function makeStubSkill(id: string, payload: unknown): Skill {
  return {
    id,
    name: id,
    version: '1.0.0',
    description: `stub for ${id}`,
    category: 'data',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute() {
      yield { type: 'result', data: payload }
    },
  }
}

describe('archetype B — content-calendar-builder', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-archB-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('loads + installs as scheduled (Mon 09:00) and pauses at the approve-drafts gate', async () => {
    const fw = findFramework('content-calendar-builder')
    expect(fw).not.toBeNull()
    expect(fw!.mode).toBe('scheduled')
    expect(fw!.schedule.cron).toBe('0 9 * * 1')

    const cfg: InstalledFrameworkConfig = {
      name: 'content-calendar-builder',
      display_name: fw!.display_name,
      description: fw!.description,
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 9 * * 1' },
      output: { destination: 'dashboard', dashboard_route: '/frameworks/content-calendar-builder' },
      inputs: {
        niche_keyword: 'gtm engineering',
        news_query: 'gtm engineering',
        account_id: 'acct_test',
        trending_min_engagement: 50,
        idea_count: 3,
      },
    }
    saveInstalledConfig(cfg)

    const reg = getSkillRegistry()
    reg.register(makeStubSkill('detect-news', { items: [{ url: 'https://x.com', title: 'Trend' }] }))
    reg.register(makeStubSkill('linkedin-trending-content', { posts: [{ post_id: 'lp1' }] }))
    reg.register(makeStubSkill('propose-campaigns', { variants: [{ id: 'v1', angle: 'a' }] }))
    reg.register(makeStubSkill('draft-content-post', { draft: { hook: 'h', body: 'b' } }))

    let pauseError: unknown = null
    try {
      await runFramework('content-calendar-builder')
    } catch (err) {
      pauseError = err
    }
    expect((pauseError as { name?: string })?.name).toBe('FrameworkGatePauseError')

    const runsDir = join(tempHome, '.gtm-os', 'agents', 'content-calendar-builder.runs')
    const files = readdirSync(runsDir).filter((f) => f.endsWith('.awaiting-gate.json'))
    expect(files.length).toBeGreaterThan(0)
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    expect(data.gate_id).toBe('approve-drafts')
  })
})
