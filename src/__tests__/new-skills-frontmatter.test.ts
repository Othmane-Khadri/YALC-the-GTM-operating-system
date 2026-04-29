import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Ajv from 'ajv'

import { loadMarkdownSkill } from '../lib/skills/markdown-loader'

const PKG_ROOT = process.cwd()
const SKILLS_DIR = join(PKG_ROOT, 'configs', 'skills')
const FIXTURES_DIR = join(PKG_ROOT, 'gold-fixtures')

interface NewSkill {
  name: string
  capability: string
}

const NEW_SKILLS: NewSkill[] = [
  { name: 'monitor-competitor-content', capability: 'linkedin-content-fetch' },
  { name: 'propose-campaigns', capability: 'reasoning' },
  { name: 'verify-campaign-launch', capability: 'reasoning' },
  { name: 'propose-magnets', capability: 'reasoning' },
  { name: 'outline-magnet', capability: 'reasoning' },
  { name: 'generate-magnet-asset', capability: 'asset-rendering' },
  { name: 'draft-content-post', capability: 'reasoning' },
]

const ajv = new Ajv({ allErrors: true, strict: false })

describe('0.9.F new bundled skills — frontmatter + fixture sanity', () => {
  for (const { name, capability } of NEW_SKILLS) {
    it(`${name} loads cleanly with declared capability + valid output_schema`, async () => {
      const path = join(SKILLS_DIR, `${name}.md`)
      expect(existsSync(path)).toBe(true)

      const result = await loadMarkdownSkill(path)
      expect(result.errors).toEqual([])
      expect(result.skill).not.toBeNull()
      expect(result.skill!.id).toBe(`md:${name}`)

      // Frontmatter parsing — re-derive from raw to catch any future drift.
      const raw = readFileSync(path, 'utf-8')
      const yamlBlock = raw.slice(raw.indexOf('---') + 3, raw.indexOf('\n---', 3))
      expect(yamlBlock).toContain(`capability: ${capability}`)
      expect(yamlBlock).toMatch(/output_schema:/)

      // Gold fixture exists and validates against the declared schema.
      const fixturePath = join(FIXTURES_DIR, name, 'basic.json')
      expect(existsSync(fixturePath)).toBe(true)
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as {
        input: Record<string, unknown>
        expected_output: unknown
      }
      expect(fixture.input).toBeDefined()
      expect(fixture.expected_output).toBeDefined()

      const schema = (result.skill as unknown as { validationSchema?: unknown }).validationSchema
      if (schema && typeof schema === 'object') {
        const validate = ajv.compile(schema as object)
        const ok = validate(fixture.expected_output)
        if (!ok) {
          // eslint-disable-next-line no-console
          console.error(`schema errors for ${name}:`, validate.errors)
        }
        expect(ok).toBe(true)
      }
    })
  }
})
