import { describe, it, expect, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  RETIRED_SKILLS,
  noteRetiredSkill,
  _resetSkillRetiredWarnings,
} from '../lib/skills/aliases'

describe('0.9.F retired Reddit-only skills', () => {
  it('the bundled markdown files are deleted', () => {
    expect(existsSync(join(process.cwd(), 'configs', 'skills', 'scrape-reddit-keyword.md'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'configs', 'skills', 'scrape-community-feed.md'))).toBe(false)
  })

  it('noteRetiredSkill returns true + emits a one-shot WARN for both names', () => {
    _resetSkillRetiredWarnings()
    expect(Object.keys(RETIRED_SKILLS).sort()).toEqual([
      'scrape-community-feed',
      'scrape-reddit-keyword',
    ])
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(noteRetiredSkill('scrape-reddit-keyword')).toBe(true)
    expect(noteRetiredSkill('scrape-reddit-keyword')).toBe(true)
    expect(noteRetiredSkill('scrape-community-feed')).toBe(true)
    expect(noteRetiredSkill('not-retired')).toBe(false)
    // Two unique names → two WARNs (the second scrape-reddit-keyword call dedups).
    expect(warnSpy).toHaveBeenCalledTimes(2)
    const messages = warnSpy.mock.calls.map((c) => c.join(' '))
    expect(messages.some((m) => m.includes('scrape-reddit-keyword'))).toBe(true)
    expect(messages.some((m) => m.includes('scrape-community-feed'))).toBe(true)
    warnSpy.mockRestore()
  })
})
