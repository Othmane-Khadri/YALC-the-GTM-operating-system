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
    category: 'content',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    requiredCapabilities: [],
    async *execute() {
      yield { type: 'result', data: payload }
    },
  }
}

describe('archetype D — lead-magnet-builder', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-archD-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('loads as on-demand and pauses at the pick-magnet gate', async () => {
    const fw = findFramework('lead-magnet-builder')
    expect(fw).not.toBeNull()
    expect(fw!.mode).toBe('on-demand')
    expect(fw!.schedule.cron).toBeUndefined()

    const cfg: InstalledFrameworkConfig = {
      name: 'lead-magnet-builder',
      display_name: fw!.display_name,
      description: fw!.description,
      installed_at: new Date().toISOString(),
      schedule: {},
      output: { destination: 'dashboard', dashboard_route: '/frameworks/lead-magnet-builder' },
      inputs: {
        target_persona: 'VP RevOps at Series B SaaS',
        format: 'html',
        deploy: 'no',
      },
    }
    saveInstalledConfig(cfg)

    const reg = getSkillRegistry()
    reg.register(
      makeStubSkill('propose-magnets', {
        magnets: [
          { id: 'm1', title: 'GTM Audit', format: 'checklist', hook: 'Find every manual step.' },
        ],
      }),
    )
    reg.register(makeStubSkill('outline-magnet', { outline: { title: 'GTM Audit', sections: [] } }))
    reg.register(makeStubSkill('generate-magnet-asset', { rendered: true, path: '/tmp/x.html', format: 'html' }))
    reg.register(makeStubSkill('landing-page-deploy', { deployed: false, url: 'file:///tmp/x.html' }))

    let pauseError: unknown = null
    try {
      await runFramework('lead-magnet-builder')
    } catch (err) {
      pauseError = err
    }
    expect((pauseError as { name?: string })?.name).toBe('FrameworkGatePauseError')

    const runsDir = join(tempHome, '.gtm-os', 'agents', 'lead-magnet-builder.runs')
    const files = readdirSync(runsDir).filter((f) => f.endsWith('.awaiting-gate.json'))
    expect(files.length).toBeGreaterThan(0)
    const data = JSON.parse(readFileSync(join(runsDir, files[0]), 'utf-8'))
    expect(data.gate_id).toBe('pick-magnet')
  })
})
