/**
 * Template `.env` writer for first-boot onboarding.
 *
 * The contract:
 *   - First boot: write a fully-commented template at `~/.gtm-os/.env`
 *     containing the auto-generated infra keys (ENCRYPTION_KEY, DATABASE_URL)
 *     plus a placeholder line for every known provider, grouped by section.
 *     The user opens the file in their editor and uncomments / fills the keys
 *     they want — no chat-pasting of API keys with Claude Code.
 *
 *   - Re-runs (file already exists): preserve every line the user has
 *     (filled keys, custom comments, hand-edited values) and APPEND any
 *     placeholder lines for providers the file does not yet mention. A
 *     timestamped separator marks the boundary so users can spot what was
 *     added by an upgrade.
 *
 *   - The parser is intentionally lenient: a line counts as "key present" if
 *     it matches `KEY=` or `# KEY=` anywhere — we don't validate values, we
 *     don't try to fix malformed lines. Worst case the existing file is
 *     preserved verbatim and we append nothing.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface EnvPlaceholder {
  /** Variable name. */
  key: string
  /** Optional inline hint shown as a `# format: ...` comment above the key. */
  hint?: string
}

export interface EnvTemplateSection {
  title: string
  placeholders: EnvPlaceholder[]
}

/**
 * Built-in provider keys the template ships with. Order is preserved when
 * rendering. Edits here flow into both first-boot writes and delta-merge
 * upgrades, so adding a new key here automatically gets it appended to
 * existing user `.env` files on the next `start` run.
 */
export const BUILTIN_PROVIDER_SECTION: EnvTemplateSection = {
  title: 'Built-in providers',
  placeholders: [
    { key: 'ANTHROPIC_API_KEY' },
    { key: 'UNIPILE_API_KEY' },
    {
      key: 'UNIPILE_DSN',
      hint: 'format: https://api{N}.unipile.com:{PORT}',
    },
    { key: 'CRUSTDATA_API_KEY' },
    { key: 'NOTION_API_KEY' },
    { key: 'FULLENRICH_API_KEY' },
    { key: 'INSTANTLY_API_KEY' },
    { key: 'FIRECRAWL_API_KEY' },
    { key: 'VOYAGE_API_KEY' },
    { key: 'OPENAI_API_KEY' },
  ],
}

export const MCP_PROVIDER_SECTION: EnvTemplateSection = {
  title: 'Common MCP providers (fill in if installed)',
  placeholders: [
    { key: 'BREVO_MCP' },
    { key: 'SOCIETEINFO_API' },
    { key: 'PAPPERS_API' },
    { key: 'HUBSPOT_PRIVATE_APP_TOKEN' },
    { key: 'SLACK_BOT_TOKEN' },
  ],
}

export const TEMPLATE_SECTIONS: EnvTemplateSection[] = [
  BUILTIN_PROVIDER_SECTION,
  MCP_PROVIDER_SECTION,
]

/** Flat list of every provider key the template tracks. */
export const ALL_TEMPLATE_KEYS: string[] = TEMPLATE_SECTIONS.flatMap((s) =>
  s.placeholders.map((p) => p.key),
)

const HEADER_BANNER = [
  '# YALC GTM-OS — Provider API Keys',
  '#',
  '# Uncomment and fill in keys for the providers you want to use,',
  '# then run: yalc-gtm doctor',
  '# to confirm they are picked up.',
  '#',
  '# This file lives at ~/.gtm-os/.env and is loaded automatically by every',
  '# YALC command. Edit it in your editor — never paste API keys in chat.',
].join('\n')

const AUTO_BANNER = '# ── Auto-generated (do not modify) ──'

function renderSection(section: EnvTemplateSection): string {
  const lines: string[] = []
  lines.push(`# ── ${section.title} ──`)
  for (const ph of section.placeholders) {
    if (ph.hint) lines.push(`# ${ph.hint}`)
    lines.push(`# ${ph.key}=`)
  }
  return lines.join('\n')
}

export interface AutoKeys {
  ENCRYPTION_KEY: string
  DATABASE_URL: string
}

/**
 * Render the full first-boot `.env` template. Pure function — no I/O.
 */
export function renderEnvTemplate(autoKeys: AutoKeys): string {
  const sections = TEMPLATE_SECTIONS.map(renderSection)
  return [
    HEADER_BANNER,
    '',
    AUTO_BANNER,
    `ENCRYPTION_KEY=${autoKeys.ENCRYPTION_KEY}`,
    `DATABASE_URL=${autoKeys.DATABASE_URL}`,
    '',
    ...sections.flatMap((rendered) => [rendered, '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n'
}

/**
 * Detect which keys the existing `.env` file already mentions. A key counts
 * as present if any line — commented or uncommented — has `KEY=` after
 * optional whitespace and an optional `#` prefix. We never parse values; the
 * goal is just to avoid duplicate placeholders when delta-merging.
 */
export function detectKeysInEnv(content: string): Set<string> {
  const found = new Set<string>()
  const lineRe = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/
  for (const rawLine of content.split('\n')) {
    const m = rawLine.match(lineRe)
    if (m) found.add(m[1])
  }
  return found
}

export interface DeltaMergeResult {
  /** Final file contents to write. */
  content: string
  /** Keys added to the file (i.e. previously missing placeholders). */
  added: string[]
}

/**
 * Compute the delta-merged `.env` contents: preserve the existing file
 * verbatim, then append any placeholder section that contains at least one
 * not-yet-present key. Sections are appended below a timestamped separator
 * so users can spot upgrade-time additions at a glance.
 *
 * We never attempt to "fix" the existing file — even malformed bytes pass
 * through unchanged. The goal is purely additive.
 */
export function deltaMergeEnv(
  existing: string,
  options: { now?: Date } = {},
): DeltaMergeResult {
  const present = detectKeysInEnv(existing)
  const added: string[] = []
  const appended: string[] = []

  for (const section of TEMPLATE_SECTIONS) {
    const missing = section.placeholders.filter((ph) => !present.has(ph.key))
    if (missing.length === 0) continue

    appended.push(`# ── ${section.title} ──`)
    for (const ph of missing) {
      if (ph.hint) appended.push(`# ${ph.hint}`)
      appended.push(`# ${ph.key}=`)
      added.push(ph.key)
    }
    appended.push('')
  }

  if (appended.length === 0) {
    return { content: existing, added }
  }

  const ts = (options.now ?? new Date()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
  const separator = `# ── Added by YALC 0.7.0 (${ts}) ──`
  const trailing = existing.endsWith('\n') ? existing : existing + '\n'
  const block = ['', separator, '', ...appended].join('\n')

  return {
    content: trailing + block.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n',
    added,
  }
}

export interface WriteEnvTemplateInput {
  /** Absolute path to `~/.gtm-os/.env`. */
  envPath: string
  /** Auto-generated infra keys. Always written on first boot. */
  autoKeys: AutoKeys
  /** Optional clock injection for tests. */
  now?: Date
}

export type WriteEnvTemplateOutcome =
  | { mode: 'created'; envPath: string; added: string[] }
  | { mode: 'merged'; envPath: string; added: string[] }
  | { mode: 'unchanged'; envPath: string; added: [] }

/**
 * High-level helper used by `runStart()`. Decides between first-boot create
 * and re-run delta-merge, performs the write, and returns metadata for the
 * caller to print. Never throws on read errors — falls back to leaving the
 * existing file alone if it cannot be parsed.
 */
export function writeEnvTemplate(input: WriteEnvTemplateInput): WriteEnvTemplateOutcome {
  const { envPath, autoKeys, now } = input
  const dir = dirname(envPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  if (!existsSync(envPath)) {
    const content = renderEnvTemplate(autoKeys)
    writeFileSync(envPath, content)
    return { mode: 'created', envPath, added: [...ALL_TEMPLATE_KEYS] }
  }

  let existing = ''
  try {
    existing = readFileSync(envPath, 'utf-8')
  } catch {
    // If the file is unreadable, do nothing — never lose user data.
    return { mode: 'unchanged', envPath, added: [] }
  }

  const merge = deltaMergeEnv(existing, { now })
  if (merge.added.length === 0) {
    return { mode: 'unchanged', envPath, added: [] }
  }
  writeFileSync(envPath, merge.content)
  return { mode: 'merged', envPath, added: merge.added }
}

/**
 * Print the post-create instructions block. Stays in this file so all
 * template UX lives in one place.
 */
export function envTemplateInstructions(envPath: string): string {
  return [
    `  ✓ Created ${envPath} with placeholder lines for every supported provider.`,
    '',
    '  Open the file in your editor:',
    `    open ${envPath}       # macOS`,
    `    xdg-open ${envPath}   # Linux`,
    `    code ${envPath}       # any platform with VS Code`,
    '',
    '  Uncomment + fill in keys for the providers you want to use.',
    '  Then run `yalc-gtm doctor` to verify they are picked up.',
  ].join('\n')
}
