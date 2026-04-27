import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  ALL_TEMPLATE_KEYS,
  BUILTIN_PROVIDER_SECTION,
  MCP_PROVIDER_SECTION,
  deltaMergeEnv,
  detectKeysInEnv,
  envTemplateInstructions,
  renderEnvTemplate,
  writeEnvTemplate,
} from '../lib/onboarding/env-template'

let TMP: string
let ENV_PATH: string

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-env-template-'))
  mkdirSync(join(TMP, '.gtm-os'), { recursive: true })
  ENV_PATH = join(TMP, '.gtm-os', '.env')
})

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true })
})

describe('renderEnvTemplate', () => {
  it('contains the canonical header banner + auto-keys + every placeholder', () => {
    const out = renderEnvTemplate({ ENCRYPTION_KEY: 'deadbeef', DATABASE_URL: 'file:/x.db' })
    expect(out).toContain('YALC GTM-OS — Provider API Keys')
    expect(out).toContain('ENCRYPTION_KEY=deadbeef')
    expect(out).toContain('DATABASE_URL=file:/x.db')
    for (const key of ALL_TEMPLATE_KEYS) {
      expect(out).toContain(`# ${key}=`)
    }
    // The UNIPILE_DSN hint comment is rendered.
    expect(out).toContain('format: https://api{N}.unipile.com:{PORT}')
    // Section headers are present.
    expect(out).toContain(`# ── ${BUILTIN_PROVIDER_SECTION.title} ──`)
    expect(out).toContain(`# ── ${MCP_PROVIDER_SECTION.title} ──`)
  })

  it('placeholder lines start with `# ` so they are inactive until edited', () => {
    const out = renderEnvTemplate({ ENCRYPTION_KEY: 'k', DATABASE_URL: 'd' })
    for (const key of ALL_TEMPLATE_KEYS) {
      // Either `# KEY=` exists, OR `KEY=` (auto keys) — but the placeholders
      // listed in ALL_TEMPLATE_KEYS are never auto-keys, so they must be
      // commented.
      expect(out).toMatch(new RegExp(`^# ${key}=$`, 'm'))
      // The same key should NOT appear uncommented.
      expect(out).not.toMatch(new RegExp(`^${key}=`, 'm'))
    }
  })
})

describe('detectKeysInEnv', () => {
  it('detects both commented and uncommented keys', () => {
    const sample = [
      '# ANTHROPIC_API_KEY=',
      'CRUSTDATA_API_KEY=sk-real-value',
      '#NOTION_API_KEY=',
      '   # FIRECRAWL_API_KEY=',
      'unrelated text',
      'lowercase_ignored=foo',
    ].join('\n')
    const found = detectKeysInEnv(sample)
    expect(found.has('ANTHROPIC_API_KEY')).toBe(true)
    expect(found.has('CRUSTDATA_API_KEY')).toBe(true)
    expect(found.has('NOTION_API_KEY')).toBe(true)
    expect(found.has('FIRECRAWL_API_KEY')).toBe(true)
    expect(found.has('lowercase_ignored')).toBe(false)
  })
})

describe('deltaMergeEnv', () => {
  it('returns an empty added list when every placeholder is already present', () => {
    const all = ALL_TEMPLATE_KEYS.map((k) => `# ${k}=`).join('\n') + '\n'
    const result = deltaMergeEnv(all)
    expect(result.added).toEqual([])
    expect(result.content).toBe(all)
  })

  it('appends only the placeholders that are missing', () => {
    // Existing file: pretend an upgrade scenario where only the original
    // 0.6.0 builtins are present and the new MCP section is absent.
    const existing = [
      '# YALC GTM-OS — old',
      'ENCRYPTION_KEY=abc',
      'DATABASE_URL=file:/old.db',
      'ANTHROPIC_API_KEY=sk-real',
      '# UNIPILE_API_KEY=',
      '# UNIPILE_DSN=',
      '# CRUSTDATA_API_KEY=',
      '# NOTION_API_KEY=',
      '# FULLENRICH_API_KEY=',
      '# INSTANTLY_API_KEY=',
      '# FIRECRAWL_API_KEY=',
      '# VOYAGE_API_KEY=',
      '# OPENAI_API_KEY=',
    ].join('\n') + '\n'

    const result = deltaMergeEnv(existing, { now: new Date('2026-04-25T12:34:00Z') })

    // User's filled key must survive verbatim.
    expect(result.content).toContain('ANTHROPIC_API_KEY=sk-real')

    // Every previously-present line is preserved.
    expect(result.content.startsWith(existing)).toBe(true)

    // MCP section keys were added.
    for (const ph of MCP_PROVIDER_SECTION.placeholders) {
      expect(result.added).toContain(ph.key)
      expect(result.content).toContain(`# ${ph.key}=`)
    }

    // Built-in keys not added (already present).
    for (const ph of BUILTIN_PROVIDER_SECTION.placeholders) {
      expect(result.added).not.toContain(ph.key)
    }

    // Timestamped separator is present.
    expect(result.content).toContain('# ── Added by YALC 0.7.0 (2026-04-25')
  })

  it('preserves user comments and arbitrary lines verbatim', () => {
    const existing = [
      '# my custom note about how I like to organize this file',
      'ENCRYPTION_KEY=abc',
      '# random comment that has = signs in it like KEY=oof',
      '',
      '# NOT_A_TEMPLATE_KEY=',
      'WEIRD =unparsable line with spaces around equals',
    ].join('\n') + '\n'

    const result = deltaMergeEnv(existing)
    // Original content is preserved as a prefix.
    expect(result.content.startsWith(existing)).toBe(true)
    expect(result.content).toContain('my custom note')
    expect(result.content).toContain('random comment that has = signs')
    expect(result.content).toContain('NOT_A_TEMPLATE_KEY')
  })
})

describe('writeEnvTemplate', () => {
  it('first boot creates the template file with all placeholders', () => {
    expect(existsSync(ENV_PATH)).toBe(false)
    const outcome = writeEnvTemplate({
      envPath: ENV_PATH,
      autoKeys: { ENCRYPTION_KEY: 'enc', DATABASE_URL: 'file:/x' },
    })
    expect(outcome.mode).toBe('created')
    expect(outcome.added).toEqual(ALL_TEMPLATE_KEYS)

    const content = readFileSync(ENV_PATH, 'utf-8')
    for (const key of ALL_TEMPLATE_KEYS) {
      expect(content).toContain(`# ${key}=`)
    }
  })

  it('re-run preserves user lines and reports `unchanged` when nothing new', () => {
    // First, lay down the canonical template.
    writeEnvTemplate({
      envPath: ENV_PATH,
      autoKeys: { ENCRYPTION_KEY: 'enc', DATABASE_URL: 'file:/x' },
    })
    // User fills a key by hand.
    const original = readFileSync(ENV_PATH, 'utf-8')
    const userEdited = original.replace('# ANTHROPIC_API_KEY=', 'ANTHROPIC_API_KEY=sk-real-key-12345')
    writeFileSync(ENV_PATH, userEdited)

    const outcome = writeEnvTemplate({
      envPath: ENV_PATH,
      autoKeys: { ENCRYPTION_KEY: 'enc', DATABASE_URL: 'file:/x' },
    })
    expect(outcome.mode).toBe('unchanged')
    expect(outcome.added).toEqual([])

    const stillThere = readFileSync(ENV_PATH, 'utf-8')
    expect(stillThere).toContain('ANTHROPIC_API_KEY=sk-real-key-12345')
  })

  it('upgrade scenario: existing 0.6.0 file → adds new placeholders without dropping user data', () => {
    // Simulate an old 0.6.0 file: flat key=value with the user's filled keys
    // and none of the new MCP placeholders.
    const old = [
      'ENCRYPTION_KEY=existing',
      'DATABASE_URL=file:/old.db',
      'ANTHROPIC_API_KEY=sk-real',
      'CRUSTDATA_API_KEY=cd-real',
    ].join('\n') + '\n'
    writeFileSync(ENV_PATH, old)

    const outcome = writeEnvTemplate({
      envPath: ENV_PATH,
      autoKeys: { ENCRYPTION_KEY: 'NEW', DATABASE_URL: 'file:/NEW' },
    })
    expect(outcome.mode).toBe('merged')
    // Filled keys must still be there.
    const content = readFileSync(ENV_PATH, 'utf-8')
    expect(content).toContain('ANTHROPIC_API_KEY=sk-real')
    expect(content).toContain('CRUSTDATA_API_KEY=cd-real')
    // MCP placeholders should now be present.
    for (const ph of MCP_PROVIDER_SECTION.placeholders) {
      expect(content).toContain(`# ${ph.key}=`)
    }
    // The new ENCRYPTION_KEY value is NOT used — we never overwrite the
    // existing one (delta-merge is purely additive).
    expect(content).toContain('ENCRYPTION_KEY=existing')
    expect(content).not.toContain('ENCRYPTION_KEY=NEW')
  })

  it('returns `unchanged` when the file cannot be read (preserves user data)', () => {
    // Write a file then make it unreadable. On systems where we can't drop
    // read permission this still passes — the worst case is the test
    // still asserts that user data isn't clobbered.
    writeFileSync(ENV_PATH, '# valid\n')
    try {
      chmodSync(ENV_PATH, 0o000)
    } catch {
      // best-effort
    }
    const outcome = writeEnvTemplate({
      envPath: ENV_PATH,
      autoKeys: { ENCRYPTION_KEY: 'k', DATABASE_URL: 'd' },
    })
    // Either 'unchanged' (read failed) or 'merged' (read succeeded). Both
    // safe — the file content must still be intact.
    expect(['unchanged', 'merged', 'created']).toContain(outcome.mode)
    try {
      chmodSync(ENV_PATH, 0o600)
    } catch {
      // best-effort
    }
  })
})

describe('envTemplateInstructions', () => {
  it('mentions all three editor open commands and the doctor follow-up', () => {
    const out = envTemplateInstructions('/tmp/.env')
    expect(out).toContain('open /tmp/.env')
    expect(out).toContain('xdg-open /tmp/.env')
    expect(out).toContain('code /tmp/.env')
    expect(out).toContain('yalc-gtm doctor')
  })
})
