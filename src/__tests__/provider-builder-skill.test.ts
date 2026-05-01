/**
 * Provider-builder skill — sanity tests.
 *
 * 1. SKILL.md frontmatter has the required fields the project's existing
 *    `.claude/skills/*\/SKILL.md` files use (`name`, `description`).
 * 2. SKILL.md description includes the spec-mandated trigger phrases so
 *    the skill router actually picks it up.
 * 3. references/yaml-template.yaml parses through `compileManifest` and
 *    surfaces an env-var reference (proves the template is well-formed
 *    and instructive — drops in a TODO_API_KEY placeholder by design).
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileManifest } from '../lib/providers/declarative/compiler'
import { ManifestValidationError } from '../lib/providers/declarative/types'

const SKILL_DIR = join(process.cwd(), '.claude', 'skills', 'provider-builder')

describe('provider-builder skill', () => {
  it('SKILL.md exists with required frontmatter fields', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    // Frontmatter is between the first two `---` lines.
    expect(raw.startsWith('---\n')).toBe(true)
    const closeIdx = raw.indexOf('\n---', 4)
    expect(closeIdx).toBeGreaterThan(0)
    const fm = raw.slice(4, closeIdx)
    expect(fm).toMatch(/^name:\s*provider-builder\s*$/m)
    expect(fm).toMatch(/^description:/m)
  })

  it('SKILL.md description includes the spec-mandated trigger phrases', () => {
    const path = join(SKILL_DIR, 'SKILL.md')
    const raw = readFileSync(path, 'utf-8')
    // Trigger phrases per spec section 4. Match in a case-insensitive,
    // whitespace-tolerant way.
    const lower = raw.toLowerCase()
    expect(lower).toContain('add a new provider for')
    expect(lower).toContain('wire up')
    expect(lower).toContain('build an adapter for')
    expect(lower).toContain('i want to use')
  })

  it('references/yaml-template.yaml exists', () => {
    expect(existsSync(join(SKILL_DIR, 'references', 'yaml-template.yaml'))).toBe(true)
  })

  it('references/yaml-template.yaml compiles cleanly through compileManifest', () => {
    const raw = readFileSync(
      join(SKILL_DIR, 'references', 'yaml-template.yaml'),
      'utf-8',
    )
    // The template is a starting point: it must parse and schema-validate
    // so a user editing it gets meaningful errors only on their own edits,
    // not on the template's baseline shape.
    let compiled
    try {
      compiled = compileManifest(raw, 'yaml-template.yaml')
    } catch (err) {
      if (err instanceof ManifestValidationError) {
        // eslint-disable-next-line no-console
        console.error('template validation issues:', err.issues)
      }
      throw err
    }
    expect(compiled.capabilityId).toBe('TODO_capability_id')
    expect(compiled.providerId).toBe('TODO_provider_id')
    // Demonstrates the env-var reference convention (`${env:VAR}`) so the
    // skill never inlines a real key.
    expect(compiled.envVars).toEqual(['TODO_API_KEY'])
    // Smoke-test block is required so the skill's step-4 loop has
    // something to run — the template seeds it with TODO placeholders.
    expect(compiled.raw.smoke_test).toBeDefined()
    expect(compiled.raw.smoke_test?.expectNonEmpty).toBeDefined()
    expect(compiled.raw.smoke_test?.expectNonEmpty?.length).toBeGreaterThan(0)
  })

  it('references/troubleshooting.md exists and is non-trivial', () => {
    const path = join(SKILL_DIR, 'references', 'troubleshooting.md')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    // A real reference doc should at minimum cover the headline failure
    // modes the skill's SKILL.md gestures at (auth, mappings, OAuth
    // out-of-scope, GraphQL).
    expect(raw.length).toBeGreaterThan(500)
    expect(raw.toLowerCase()).toMatch(/oauth/)
    expect(raw.toLowerCase()).toMatch(/graphql/)
    expect(raw.toLowerCase()).toMatch(/missingapikeyerror/)
  })
})
