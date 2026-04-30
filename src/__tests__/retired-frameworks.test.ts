import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { RETIRED_FRAMEWORKS, findRetiredFramework, isRetiredFramework } from '../lib/frameworks/retired'
import { saveInstalledConfig, listInstalledFrameworks } from '../lib/frameworks/registry'
import type { InstalledFrameworkConfig } from '../lib/frameworks/types'

const RETIRED_NAMES = [
  'daily-competitor-monitoring',
  'weekly-engagement-harvest',
  'daily-icp-signal-detection',
  'inbound-reply-triage',
  'weekly-content-radar',
  'daily-funded-companies',
]

describe('0.9.F retired frameworks', () => {
  it('every retired-yaml file is deleted from configs/frameworks/', () => {
    for (const name of RETIRED_NAMES) {
      const path = join(process.cwd(), 'configs', 'frameworks', `${name}.yaml`)
      expect(existsSync(path)).toBe(false)
    }
  })

  it('RETIRED_FRAMEWORKS exposes a name → replacement map for every retired entry', () => {
    expect(RETIRED_FRAMEWORKS.length).toBe(6)
    for (const name of RETIRED_NAMES) {
      expect(isRetiredFramework(name)).toBe(true)
      const r = findRetiredFramework(name)
      expect(r).not.toBeNull()
      expect(r!.replacement).toMatch(/^(competitor-audience-mining|content-calendar-builder|outreach-campaign-builder|lead-magnet-builder)$/)
    }
  })

  describe('doctor + framework:list emit retirement WARN when installed', () => {
    let prevHome: string | undefined
    let tempHome: string

    beforeEach(() => {
      prevHome = process.env.HOME
      tempHome = join(tmpdir(), `yalc-retired-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      mkdirSync(tempHome, { recursive: true })
      process.env.HOME = tempHome
    })

    afterEach(() => {
      process.env.HOME = prevHome
      if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
    })

    it('framework:list surfaces retired entries with the replacement archetype', async () => {
      const cfg: InstalledFrameworkConfig = {
        name: 'daily-competitor-monitoring',
        display_name: 'Daily Competitor Monitoring',
        description: 'legacy',
        installed_at: new Date().toISOString(),
        schedule: { cron: '0 8 * * *' },
        output: { destination: 'dashboard', dashboard_route: '/x' },
        inputs: {},
      }
      saveInstalledConfig(cfg)
      expect(listInstalledFrameworks()).toContain('daily-competitor-monitoring')

      const captured: string[] = []
      const origLog = console.log
      console.log = (...args: unknown[]) => {
        captured.push(args.map((a) => String(a)).join(' '))
      }
      try {
        const { runFrameworkList } = await import('../cli/commands/framework')
        await runFrameworkList()
      } finally {
        console.log = origLog
      }
      const text = captured.join('\n')
      expect(text).toContain('daily-competitor-monitoring')
      expect(text).toContain('retired (replaced by competitor-audience-mining)')
    })
  })
})
