import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SCRIPT = join(process.cwd(), 'scripts', 'lint-skill-triggers.mjs')

function makeSkill(root: string, name: string, frontmatter: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n# ${name}\n`)
}

function runLinter(skillsDir: string): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [SCRIPT, '--skills-dir', skillsDir], {
    encoding: 'utf8',
  })
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  }
}

describe('lint-skill-triggers script', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'lint-skill-triggers-'))
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('exits 0 when there are no overlapping trigger phrases', () => {
    makeSkill(
      tmp,
      'alpha',
      `name: alpha\ndescription: Use when the user says "qualify these leads" or "score this list".\nversion: 1.0.0`,
    )
    makeSkill(
      tmp,
      'beta',
      `name: beta\ndescription: Use when the user says "publish blog article" or "draft the newsletter".\nversion: 1.0.0`,
    )

    const { code, stdout } = runLinter(tmp)
    expect(code, `stdout:\n${stdout}`).toBe(0)
  })

  it('exits 1 and prints both skill names + phrases when triggers overlap (substring)', () => {
    makeSkill(
      tmp,
      'alpha',
      `name: alpha\ndescription: Use when the user says "qualify these leads now" or "score this list".\nversion: 1.0.0`,
    )
    makeSkill(
      tmp,
      'beta',
      `name: beta\ndescription: Use when the user says "qualify these leads" or "draft the newsletter".\nversion: 1.0.0`,
    )

    const { code, stdout } = runLinter(tmp)
    expect(code).toBe(1)
    expect(stdout).toContain('alpha')
    expect(stdout).toContain('beta')
    expect(stdout).toContain('qualify these leads')
  })

  it('exits 1 on exact-match overlapping triggers', () => {
    makeSkill(
      tmp,
      'gamma',
      `name: gamma\ndescription: Use when user says "send a cold email" or "kick off campaign".\nversion: 1.0.0`,
    )
    makeSkill(
      tmp,
      'delta',
      `name: delta\ndescription: Use when user says "send a cold email" or "create new sequence".\nversion: 1.0.0`,
    )

    const { code, stdout } = runLinter(tmp)
    expect(code).toBe(1)
    expect(stdout).toContain('gamma')
    expect(stdout).toContain('delta')
  })

  it('respects trigger_overlap_allowed opt-out from one side', () => {
    makeSkill(
      tmp,
      'alpha',
      `name: alpha\ndescription: Use when the user says "qualify these leads" or "score this list".\nversion: 1.0.0\ntrigger_overlap_allowed:\n  - beta`,
    )
    makeSkill(
      tmp,
      'beta',
      `name: beta\ndescription: Use when the user says "qualify these leads" or "draft the newsletter".\nversion: 1.0.0`,
    )

    const { code } = runLinter(tmp)
    expect(code).toBe(0)
  })

  it('ignores generic short tokens that happen to be quoted', () => {
    // <=5 char quoted phrases must not trigger collisions on their own.
    makeSkill(
      tmp,
      'alpha',
      `name: alpha\ndescription: Use when user says "for" or "qualify these leads".\nversion: 1.0.0`,
    )
    makeSkill(
      tmp,
      'beta',
      `name: beta\ndescription: Use when user says "for" or "publish blog article".\nversion: 1.0.0`,
    )

    const { code } = runLinter(tmp)
    expect(code).toBe(0)
  })

  it('treats overlap as bidirectional substring (B contains A and A contains B)', () => {
    makeSkill(
      tmp,
      'shorty',
      `name: shorty\ndescription: Use when user says "campaign report".\nversion: 1.0.0`,
    )
    makeSkill(
      tmp,
      'longy',
      `name: longy\ndescription: Use when user says "weekly campaign report please".\nversion: 1.0.0`,
    )

    const { code, stdout } = runLinter(tmp)
    expect(code).toBe(1)
    expect(stdout).toContain('campaign report')
  })
})
