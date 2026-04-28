import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { resolveFileReference, substituteStepInput } from '../lib/frameworks/runner'
import { loadMarkdownSkill } from '../lib/skills/markdown-loader'

/**
 * Regression tests for the four 0.8.D bug fixes. Each test fails when the
 * fix is reverted.
 */

const PKG_ROOT = process.cwd()
const SKILLS_DIR = join(PKG_ROOT, 'configs', 'skills')

describe('D1.2 — qualify-engagers no longer reads the filesystem', () => {
  it('body uses {{icp_yaml_content}} and contains no filesystem-read instruction', () => {
    const body = readFileSync(join(SKILLS_DIR, 'qualify-engagers.md'), 'utf-8')
    expect(body).toMatch(/\{\{icp_yaml_content\}\}/)
    // Strip the frontmatter description (which legitimately mentions the
    // canonical icp/segments.yaml path) so the assertion only inspects the
    // prompt body itself.
    const trimmed = body.trimStart()
    let promptOnly = body
    if (trimmed.startsWith('---')) {
      const end = trimmed.indexOf('\n---', 3)
      if (end !== -1) {
        promptOnly = trimmed.slice(end + 4)
      }
    }
    // The body must NEVER tell the model to "read" / "open" / "load" a
    // file path. The captured-context wording inside a parenthetical is
    // fine, but no imperative file-system instruction.
    expect(promptOnly).not.toMatch(/\bread\s+`?~\/\.gtm-os/i)
    expect(promptOnly).not.toMatch(/\bread\s+the\s+file/i)
    expect(promptOnly).not.toMatch(/\bopen\s+`?~\/\.gtm-os/i)
  })

  it('icp_yaml_content is a required input on the skill', async () => {
    const result = await loadMarkdownSkill(join(SKILLS_DIR, 'qualify-engagers.md'))
    expect(result.errors).toEqual([])
    const required = (result.skill!.inputSchema as { required?: string[] }).required ?? []
    expect(required).toContain('icp_yaml_content')
  })
})

describe('D1.2 — $file:<path> resolver injects file contents into step inputs', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-d12-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('resolves ~/.gtm-os/icp/segments.yaml against HOME', () => {
    const icpDir = join(tempHome, '.gtm-os', 'icp')
    mkdirSync(icpDir, { recursive: true })
    const sentinel = 'target_roles:\n  - Head of RevOps\n'
    writeFileSync(join(icpDir, 'segments.yaml'), sentinel, 'utf-8')
    const got = resolveFileReference('$file:~/.gtm-os/icp/segments.yaml')
    expect(got).toBe(sentinel)
  })

  it('returns empty string when the file is missing (graceful degrade)', () => {
    expect(resolveFileReference('$file:~/.gtm-os/icp/does-not-exist.yaml')).toBe('')
  })

  it('substituteStepInput injects $file contents at framework-run time', () => {
    const icpDir = join(tempHome, '.gtm-os', 'icp')
    mkdirSync(icpDir, { recursive: true })
    const sentinel = 'industries:\n  - SaaS\n'
    writeFileSync(join(icpDir, 'segments.yaml'), sentinel, 'utf-8')
    const stepInput = {
      engagers: '{{steps[0].output}}',
      min_score: '{{min_quality_score}}',
      icp_yaml_content: '$file:~/.gtm-os/icp/segments.yaml',
    }
    const resolved = substituteStepInput(stepInput, { min_quality_score: 60 }, [
      [{ name: 'Alex' }],
    ]) as Record<string, unknown>
    expect(resolved.icp_yaml_content).toBe(sentinel)
    expect(resolved.engagers).toEqual([{ name: 'Alex' }])
    expect(resolved.min_score).toBe(60)
  })
})

describe('D1.3 — icp-company-search body has no Crustdata field-name leakage', () => {
  it('body never references provider-specific column names', () => {
    const body = readFileSync(join(SKILLS_DIR, 'icp-company-search.md'), 'utf-8')
    const forbidden = [
      'headcount_range_min',
      'headcount_range_max',
      'last_round_size_usd',
      'company_search_db',
      'crustdata_company_search',
      'company_id',
    ]
    for (const tok of forbidden) {
      expect(body).not.toMatch(new RegExp(tok, 'i'))
    }
  })
})

describe('D1.4 — list-recent-linkedin-posts requires account_id', () => {
  it('account_id is required and the body uses it', async () => {
    const result = await loadMarkdownSkill(join(SKILLS_DIR, 'list-recent-linkedin-posts.md'))
    expect(result.errors).toEqual([])
    const required = (result.skill!.inputSchema as { required?: string[] }).required ?? []
    expect(required).toContain('account_id')
    const body = readFileSync(join(SKILLS_DIR, 'list-recent-linkedin-posts.md'), 'utf-8')
    expect(body).toMatch(/\{\{account_id\}\}/)
  })

  it('scrape-post-engagers also declares account_id as required', async () => {
    const result = await loadMarkdownSkill(join(SKILLS_DIR, 'scrape-post-engagers.md'))
    expect(result.errors).toEqual([])
    const required = (result.skill!.inputSchema as { required?: string[] }).required ?? []
    expect(required).toContain('account_id')
  })

  it('weekly-engagement-harvest framework yaml passes account_id to both LinkedIn steps', () => {
    const yaml = readFileSync(
      join(PKG_ROOT, 'configs', 'frameworks', 'weekly-engagement-harvest.yaml'),
      'utf-8',
    )
    expect(yaml).toMatch(/account_id:\s*"\{\{linkedin_account_id\}\}"/)
    expect(yaml).toMatch(/linkedin_account_id/)
    // And it sources from $context (with a doctor WARN when missing).
    expect(yaml).toMatch(/\$context\.sources\.linkedin_account_id/)
  })
})
