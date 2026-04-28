import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { substituteStepInput } from '../lib/frameworks/runner'
import { loadMarkdownSkill } from '../lib/skills/markdown-loader'

const PKG_ROOT = process.cwd()
const SKILL_PATH = join(PKG_ROOT, 'configs', 'skills', 'suggest-reply-action.md')

describe('E4 — suggest-reply-action no longer reads the filesystem', () => {
  it('body uses {{voice_md_content}} and contains no filesystem-read instruction', async () => {
    const raw = readFileSync(SKILL_PATH, 'utf-8')
    expect(raw).toMatch(/\{\{voice_md_content\}\}/)
    // Strip the frontmatter so we only inspect the prompt body.
    const trimmed = raw.trimStart()
    let promptOnly = raw
    if (trimmed.startsWith('---')) {
      const end = trimmed.indexOf('\n---', 3)
      if (end !== -1) promptOnly = trimmed.slice(end + 4)
    }
    expect(promptOnly).not.toMatch(/\bread\s+`?~\/\.gtm-os/i)
    expect(promptOnly).not.toMatch(/\bread\s+the\s+file/i)
    expect(promptOnly).not.toMatch(/\bopen\s+`?~\/\.gtm-os/i)
    // Specifically, the legacy "read `~/.gtm-os/voice.md`" pattern is gone.
    expect(promptOnly).not.toMatch(/read\s+`?~\/\.gtm-os\/voice\.md/i)

    const result = await loadMarkdownSkill(SKILL_PATH)
    expect(result.errors).toEqual([])
    const required = (result.skill!.inputSchema as { required?: string[] }).required ?? []
    expect(required).toContain('voice_md_content')
  })
})

describe('E4 — framework runner injects voice file via $file resolver', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-e4-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('substituteStepInput injects ~/.gtm-os/voice/tone-of-voice.md content', () => {
    const voiceDir = join(tempHome, '.gtm-os', 'voice')
    mkdirSync(voiceDir, { recursive: true })
    const sentinel = '# Tone\n- Direct, never pushy.\n'
    writeFileSync(join(voiceDir, 'tone-of-voice.md'), sentinel, 'utf-8')

    const stepInput = {
      replies: '{{steps[0].output}}',
      voice_md_content: '$file:~/.gtm-os/voice/tone-of-voice.md',
    }
    const resolved = substituteStepInput(stepInput, {}, [
      [{ thread_id: 'thr-1', body: 'hi' }],
    ]) as Record<string, unknown>

    expect(resolved.voice_md_content).toBe(sentinel)
    expect(resolved.replies).toEqual([{ thread_id: 'thr-1', body: 'hi' }])

    // And the framework yaml carries the resolver reference.
    const fwk = readFileSync(
      join(PKG_ROOT, 'configs', 'frameworks', 'inbound-reply-triage.yaml'),
      'utf-8',
    )
    expect(fwk).toMatch(/voice_md_content:\s*"\$file:~\/\.gtm-os\/voice\/tone-of-voice\.md"/)
  })
})
