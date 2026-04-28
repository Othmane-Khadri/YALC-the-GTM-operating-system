import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { loadMarkdownSkill } from '../lib/skills/markdown-loader'
import { validateMarkdownSkill, type MarkdownSkillDefinition } from '../lib/skills/markdown-validator'
import {
  CapabilityRegistry,
  CapabilityUnsatisfied,
  resetCapabilityRegistry,
} from '../lib/providers/capabilities'

function writeSkillFile(dir: string, name: string, frontmatter: string, body: string): string {
  const path = join(dir, `${name}.md`)
  writeFileSync(path, `---\n${frontmatter}\n---\n${body}\n`, 'utf-8')
  return path
}

describe('skill capability resolution', () => {
  let prevHome: string | undefined
  let tempHome: string
  let skillsDir: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-skill-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
    skillsDir = join(tempHome, 'skills')
    mkdirSync(skillsDir, { recursive: true })
    resetCapabilityRegistry()
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
    resetCapabilityRegistry()
    vi.restoreAllMocks()
  })

  it('loads a skill that declares only `capability:` (no provider)', async () => {
    const path = writeSkillFile(
      skillsDir,
      'cap-only',
      [
        'name: cap-only',
        'description: Test skill with capability only.',
        'capability: reasoning',
        'inputs:',
        '  - name: prompt',
        '    description: prompt input',
      ].join('\n'),
      'Hello {{prompt}}',
    )
    const result = await loadMarkdownSkill(path)
    expect(result.errors).toEqual([])
    expect(result.skill).toBeTruthy()
  })

  it('loads a skill that declares only `provider:` (legacy path unchanged)', async () => {
    const path = writeSkillFile(
      skillsDir,
      'provider-only',
      [
        'name: provider-only',
        'description: Legacy skill.',
        'provider: crustdata',
        'inputs:',
        '  - name: q',
        '    description: query',
      ].join('\n'),
      'Search for {{q}}',
    )
    const result = await loadMarkdownSkill(path)
    expect(result.errors).toEqual([])
    expect(result.skill).toBeTruthy()
  })

  it('logs a WARN when both `capability:` and `provider:` are declared, and capability wins at runtime', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const path = writeSkillFile(
      skillsDir,
      'both-declared',
      [
        'name: both-declared',
        'description: A skill with both fields.',
        'capability: reasoning',
        'provider: crustdata',
        'inputs:',
        '  - name: prompt',
        '    description: prompt input',
      ].join('\n'),
      'Hello {{prompt}}',
    )
    const result = await loadMarkdownSkill(path)
    expect(result.errors).toEqual([])
    expect(result.skill).toBeTruthy()
    expect(warnSpy).toHaveBeenCalled()
    const warnMessage = (warnSpy.mock.calls[0][0] as string) ?? ''
    expect(warnMessage).toMatch(/capability will be used/)
    warnSpy.mockRestore()
  })

  it('rejects a skill that declares neither `provider:` nor `capability:`', () => {
    const def: MarkdownSkillDefinition = {
      name: 'invalid',
      description: 'Missing routing.',
      inputs: [{ name: 'q', description: 'query' }],
    }
    const errors = validateMarkdownSkill(def, 'Body {{q}}')
    expect(errors.some((e) => /provider|capability/.test(e))).toBe(true)
  })

  it('surfaces an actionable error when the capability has no installed provider', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'lonely',
      description: 'no providers installed',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['ghost-a', 'ghost-b'],
    })
    try {
      await reg.resolve('lonely')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityUnsatisfied)
      const e = err as CapabilityUnsatisfied
      expect(e.message).toContain('ghost-a')
      expect(e.message).toContain('ghost-b')
      expect(e.message).toMatch(/provider:add|connect-provider/)
    }
  })

  it('honors HOME-isolated config.yaml when resolving capability priority', async () => {
    const cfgDir = join(tempHome, '.gtm-os')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(
      join(cfgDir, 'config.yaml'),
      'capabilities:\n  testcap:\n    priority: [b, a]\n',
      'utf-8',
    )
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'testcap',
      description: '',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['a', 'b'],
    })
    reg.register({
      capabilityId: 'testcap',
      providerId: 'a',
      isAvailable: () => true,
      async execute() {
        return { winner: 'a' }
      },
    })
    reg.register({
      capabilityId: 'testcap',
      providerId: 'b',
      isAvailable: () => true,
      async execute() {
        return { winner: 'b' }
      },
    })
    const adapter = await reg.resolve('testcap')
    expect(adapter.providerId).toBe('b')
  })
})
