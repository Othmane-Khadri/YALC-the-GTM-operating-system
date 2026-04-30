import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { loadMarkdownSkill } from '../lib/skills/markdown-loader'
import { getCapabilityRegistryReady } from '../lib/providers/capabilities'
import { PKG_ROOT } from '../lib/paths'

const SKILLS_DIR = join(PKG_ROOT, 'configs', 'skills')
const FRAMEWORKS_DIR = join(PKG_ROOT, 'configs', 'frameworks')

describe('0.8.C skill migration', () => {
  it('every bundled skill in configs/skills/ parses without errors', async () => {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const f of files) {
      const result = await loadMarkdownSkill(join(SKILLS_DIR, f))
      if (!result.skill) {
        failures.push(`${f}: ${result.errors.join('; ')}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('every bundled skill that declares capability: resolves via the registry', async () => {
    const registry = await getCapabilityRegistryReady()
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith('.md'))
    const seen: Record<string, boolean> = {}
    for (const f of files) {
      const raw = readFileSync(join(SKILLS_DIR, f), 'utf-8')
      const m = raw.match(/^---\n([\s\S]*?)\n---/)
      if (!m) continue
      const fmMatch = m[1].match(/^capability:\s*([\w-]+)\s*$/m)
      if (!fmMatch) continue
      const cap = fmMatch[1]
      seen[cap] = true
      const def = registry.getCapability(cap)
      expect(def, `capability '${cap}' (referenced by ${f}) is not registered`).not.toBeNull()
    }
    // Sanity: at least the well-known ones must be hit by the migration.
    expect(Object.keys(seen).length).toBeGreaterThanOrEqual(8)
  })

  it('crustdata-funding-feed.md is deleted', () => {
    expect(existsSync(join(SKILLS_DIR, 'crustdata-funding-feed.md'))).toBe(false)
  })

  it('icp-company-search resolves under both new and old (aliased) name', async () => {
    expect(existsSync(join(SKILLS_DIR, 'icp-company-search.md'))).toBe(true)
    expect(existsSync(join(SKILLS_DIR, 'crustdata-icp-search.md'))).toBe(false)
    const { resolveSkillAlias } = await import('../lib/skills/aliases')
    const resolved = resolveSkillAlias('crustdata-icp-search')
    expect(resolved).toBe('icp-company-search')
  })

  it('all bundled framework yamls parse and reference resolvable step skills', async () => {
    const frameworkFiles = readdirSync(FRAMEWORKS_DIR).filter((f) => f.endsWith('.yaml'))
    expect(frameworkFiles.length).toBeGreaterThan(0)
    const knownSkills = new Set(
      readdirSync(SKILLS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, '')),
    )
    // Add aliases — they redirect to existing skill files.
    const { SKILL_ALIASES } = await import('../lib/skills/aliases')
    for (const alias of Object.keys(SKILL_ALIASES)) knownSkills.add(alias)

    for (const f of frameworkFiles) {
      const parsed = yaml.load(readFileSync(join(FRAMEWORKS_DIR, f), 'utf-8')) as {
        steps?: Array<{ skill?: string }>
      }
      expect(parsed, f).toBeTruthy()
      const steps = parsed.steps ?? []
      for (const s of steps) {
        if (!s.skill) continue
        expect(knownSkills.has(s.skill), `${f}: skill '${s.skill}' not found`).toBe(true)
      }
    }
  })
})
