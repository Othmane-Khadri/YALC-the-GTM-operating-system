import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { findFramework } from '../lib/frameworks/loader'
import { runFramework, EXIT_CODE_AWAITING_GATE } from '../lib/frameworks/runner'
import { saveInstalledConfig } from '../lib/frameworks/registry'
import { getSkillRegistry } from '../lib/skills/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'
import type { Skill } from '../lib/skills/types'

/**
 * Archetype A integration test — competitor-audience-mining (LinkedIn-only).
 *
 * The framework installs with a cron schedule, runs end-to-end through
 * mocked skills, and pauses at the human-gate step. The gate surface +
 * payload_from_step are confirmed by the awaiting-gate JSON the runner
 * emits to disk on pause.
 */

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

describe('archetype A — competitor-audience-mining', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-archA-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('loads + installs as scheduled, runs, and pauses at the human gate', async () => {
    const fw = findFramework('competitor-audience-mining')
    expect(fw).not.toBeNull()
    expect(fw!.mode).toBe('scheduled')
    expect(fw!.schedule.cron).toBe('0 9 * * *')

    const cfg: InstalledFrameworkConfig = {
      name: 'competitor-audience-mining',
      display_name: fw!.display_name,
      description: fw!.description,
      installed_at: new Date().toISOString(),
      schedule: { cron: '0 9 * * *' },
      output: { destination: 'dashboard', dashboard_route: '/frameworks/competitor-audience-mining' },
      inputs: {
        competitor_url: 'https://www.linkedin.com/company/clay-com/',
        account_id: 'acct_test',
        posts_lookback: 3,
        top_n: 5,
      },
    }
    saveInstalledConfig(cfg)

    const reg = getSkillRegistry()
    reg.register(makeStubSkill('monitor-competitor-content', { posts: [{ post_id: 'p1' }] }))
    reg.register(makeStubSkill('scrape-post-engagers', { engagers: [{ name: 'Jane' }] }))
    reg.register(makeStubSkill('enrich-email', { contacts: [{ email: 'jane@acme.com' }] }))
    reg.register(makeStubSkill('qualify-engagers', { qualified: [{ score: 75 }] }))
    reg.register(makeStubSkill('rank-and-truncate', { ranked: [{ rank: 1, name: 'Jane' }] }))

    let pauseError: unknown = null
    try {
      await runFramework('competitor-audience-mining')
    } catch (err) {
      pauseError = err
    }
    // Runner pauses at the gate by throwing a FrameworkGatePauseError.
    expect(pauseError).toBeTruthy()
    expect((pauseError as { name: string }).name).toBe('FrameworkGatePauseError')
    expect(EXIT_CODE_AWAITING_GATE).toBe(30)

    // Awaiting-gate JSON written under <tempHome>/.gtm-os/agents/<name>.runs/.
    const runsDir = join(tempHome, '.gtm-os', 'agents', 'competitor-audience-mining.runs')
    expect(existsSync(runsDir)).toBe(true)
    const files = readdirSync(runsDir).filter((f) => f.endsWith('.awaiting-gate.json'))
    expect(files.length).toBeGreaterThan(0)
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    expect(data.gate_id).toBe('approve-engagers')
    expect(data.framework).toBe('competitor-audience-mining')
  })
})
