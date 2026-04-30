/**
 * Tests for the `mode: scheduled | on-demand` framework field (0.9.E).
 *
 * Loader-level validation tests use `parseFrameworkYaml` directly. Install
 * tests drive the install path via the CLI command (with --auto-confirm and
 * --destination dashboard) so they cover the launchd yaml side-effect.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseFrameworkYaml, FrameworkDefinitionError } from '../lib/frameworks/loader'
import { runFrameworkInstall } from '../cli/commands/framework'
import { agentYamlPath, removeInstalledConfig } from '../lib/frameworks/registry'

describe('framework yaml mode field', () => {
  it('rejects scheduled mode with no schedule.cron', () => {
    const yaml = `
name: bad
display_name: Bad
description: x
mode: scheduled
inputs: []
schedule: {}
steps:
  - skill: x
output:
  destination_choice:
    - dashboard: { route: "/x" }
`
    expect(() => parseFrameworkYaml('/x/bad.yaml', yaml)).toThrow(
      /scheduled frameworks must declare "schedule.cron"/,
    )
  })

  it('rejects on-demand mode that declares schedule.cron', () => {
    const yaml = `
name: bad
display_name: Bad
description: x
mode: on-demand
inputs: []
schedule:
  cron: "0 8 * * *"
steps:
  - skill: x
output:
  destination_choice:
    - dashboard: { route: "/x" }
`
    expect(() => parseFrameworkYaml('/x/bad.yaml', yaml)).toThrow(
      /on-demand frameworks must not declare/,
    )
  })

  it('accepts on-demand with no schedule block at all', () => {
    const yaml = `
name: ok
display_name: OK
description: x
mode: on-demand
inputs: []
steps:
  - skill: x
output:
  destination_choice:
    - dashboard: { route: "/x" }
`
    const f = parseFrameworkYaml('/x/ok.yaml', yaml)
    expect(f.mode).toBe('on-demand')
    expect(f.schedule.cron).toBeUndefined()
  })

  it('falls back to scheduled when mode is omitted (0.7.0/0.8.0 backward compat)', () => {
    const yaml = `
name: legacy
display_name: Legacy
description: x
inputs: []
schedule:
  cron: "0 8 * * *"
steps:
  - skill: x
output:
  destination_choice:
    - dashboard: { route: "/x" }
`
    const f = parseFrameworkYaml('/x/legacy.yaml', yaml)
    expect(f.mode).toBe('scheduled')
  })
})

// ─── install side-effects ──────────────────────────────────────────────────
//
// install creates `~/.gtm-os/agents/<name>.yaml` for scheduled frameworks
// (the launchd-readable file). on-demand installs MUST NOT create it.

describe('framework install — launchd yaml side-effect (HOME-isolated)', () => {
  let prevHome: string | undefined
  let prevCwd: string
  let tempHome: string
  let bundledFwDir: string

  beforeEach(() => {
    prevHome = process.env.HOME
    prevCwd = process.cwd()
    tempHome = join(tmpdir(), `yalc-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    bundledFwDir = join(prevCwd, 'configs', 'frameworks')
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  function writeFw(name: string, body: string) {
    const p = join(bundledFwDir, `${name}.yaml`)
    writeFileSync(p, body, 'utf-8')
    return p
  }

  it('on-demand install does NOT create an agent yaml under ~/.gtm-os/agents/', async () => {
    const name = `mode-ondemand-${Date.now()}`
    const path = writeFw(
      name,
      `
name: ${name}
display_name: On-Demand
description: x
mode: on-demand
inputs:
  - name: who
    description: target
    default: "world"
steps:
  - skill: noop-skill
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`,
    )
    try {
      await runFrameworkInstall(name, { autoConfirm: true, destination: 'dashboard' })
      expect(existsSync(agentYamlPath(name))).toBe(false)
    } finally {
      removeInstalledConfig(name)
      if (existsSync(path)) rmSync(path, { force: true })
    }
  })

  it('scheduled install DOES create an agent yaml under ~/.gtm-os/agents/', async () => {
    const name = `mode-scheduled-${Date.now()}`
    const path = writeFw(
      name,
      `
name: ${name}
display_name: Scheduled
description: x
inputs:
  - name: who
    description: target
    default: "world"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: noop-skill
output:
  destination_choice:
    - dashboard: { route: "/frameworks/${name}" }
`,
    )
    try {
      await runFrameworkInstall(name, { autoConfirm: true, destination: 'dashboard' })
      expect(existsSync(agentYamlPath(name))).toBe(true)
    } finally {
      removeInstalledConfig(name)
      if (existsSync(path)) rmSync(path, { force: true })
    }
  })
})
