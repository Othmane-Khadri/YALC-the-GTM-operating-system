/**
 * Tests for the archetype-pref reader (C3).
 *
 * The reader is intentionally tiny — it parses `~/.gtm-os/config.yaml`
 * with js-yaml, looks for a single `archetype` key, and resolves to the
 * matching id (a/b/c/d) when set. Everything else (missing file, parse
 * error, unknown value) falls through to null.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readArchetypePreference } from '../lib/config/archetype-pref'

let TMP: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-archetype-pref-'))
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

function writeConfig(yaml: string) {
  const dir = join(TMP, '.gtm-os')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.yaml'), yaml)
}

describe('readArchetypePreference', () => {
  it('returns null when config.yaml is missing', () => {
    expect(readArchetypePreference({ homeOverride: TMP })).toBeNull()
  })

  it('returns the archetype id when set', () => {
    writeConfig('archetype: c\n')
    expect(readArchetypePreference({ homeOverride: TMP })).toBe('c')
  })

  it('lowercases the archetype letter', () => {
    writeConfig('archetype: B\n')
    expect(readArchetypePreference({ homeOverride: TMP })).toBe('b')
  })

  it('returns null for unknown letters', () => {
    writeConfig('archetype: z\n')
    expect(readArchetypePreference({ homeOverride: TMP })).toBeNull()
  })

  it('returns null for malformed yaml', () => {
    writeConfig(': : :')
    expect(readArchetypePreference({ homeOverride: TMP })).toBeNull()
  })

  it('returns null when the key is missing', () => {
    writeConfig('something_else: 1\n')
    expect(readArchetypePreference({ homeOverride: TMP })).toBeNull()
  })
})
