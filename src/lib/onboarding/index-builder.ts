/**
 * Human-readable index of the onboarding folder (0.6.0).
 *
 * `buildIndex(rootPath, isPreview)` walks a preview or live root, emits
 * a markdown table with `File | What it contains | Updated`, and writes
 * it to `<rootPath>/_index.md`.
 *
 * Description strings come from a static map (path → description). Anything
 * not in the map gets a generic placeholder so unknown files still surface.
 *
 * When `isPreview` is true we prepend a "Preview" banner so the user knows
 * to commit before relying on the data.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'

const FILE_DESCRIPTIONS: Record<string, string> = {
  'company_context.yaml': 'Captured answers about your company, ICP, voice',
  'framework.yaml': 'Derived segments, signals, positioning',
  'voice/tone-of-voice.md': 'Extracted voice rules — do/don\'t list, signature phrases',
  'voice/examples.md': 'Voice examples sourced from your samples',
  'icp/segments.yaml': 'ICP segments with target roles, industries, pain points',
  'positioning/one-pager.md': 'One-page positioning brief',
  'qualification_rules.md': 'Lead-scoring patterns + disqualifiers',
  'campaign_templates.yaml': 'Outreach copy templates (connect note, DM1, DM2)',
  'search_queries.txt': 'Monitoring keywords for inbound signal capture',
}

/** Human-friendly description for a canonical relative path. */
export function describePath(rel: string): string {
  if (FILE_DESCRIPTIONS[rel]) return FILE_DESCRIPTIONS[rel]
  if (rel.startsWith('positioning/battlecards/')) {
    const slug = rel.slice('positioning/battlecards/'.length).replace(/\.md$/, '')
    return `Battlecard for ${slug}`
  }
  return '(custom file)'
}

interface IndexEntry {
  rel: string
  description: string
  updatedISO: string
}

function listIndexableFiles(root: string): IndexEntry[] {
  if (!existsSync(root)) return []
  const out: IndexEntry[] = []
  const visit = (dir: string) => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      // Skip housekeeping files we don't list in the index itself.
      if (name === '_index.md' || name === '_meta.json') continue
      const full = join(dir, name)
      let s: ReturnType<typeof statSync>
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (s.isDirectory()) {
        visit(full)
        continue
      }
      const rel = relative(root, full)
      out.push({
        rel,
        description: describePath(rel),
        updatedISO: s.mtime.toISOString(),
      })
    }
  }
  visit(root)
  // Stable, deterministic ordering — paths in FILE_DESCRIPTIONS first (in
  // declaration order), everything else alphabetically.
  const knownOrder = Object.keys(FILE_DESCRIPTIONS)
  out.sort((a, b) => {
    const ai = knownOrder.indexOf(a.rel)
    const bi = knownOrder.indexOf(b.rel)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.rel.localeCompare(b.rel)
  })
  return out
}

/**
 * Build and write `_index.md` inside the given root. Creates the directory
 * if it does not exist (relevant for fresh preview folders).
 */
export function buildIndex(rootPath: string, isPreview: boolean): string {
  if (!existsSync(rootPath)) mkdirSync(rootPath, { recursive: true })

  const entries = listIndexableFiles(rootPath)
  const lines: string[] = []
  if (isPreview) {
    lines.push(
      '> **Preview** — review and run `yalc-gtm start --commit-preview` to make these live.',
    )
    lines.push('')
  }
  lines.push('# Your GTM brain — index')
  lines.push('')
  lines.push('| File | What it contains | Updated |')
  lines.push('|---|---|---|')
  if (entries.length === 0) {
    lines.push('| _empty_ | (nothing has been generated yet) | — |')
  } else {
    for (const e of entries) {
      const date = e.updatedISO.slice(0, 10)
      lines.push(`| \`${e.rel}\` | ${e.description} | ${date} |`)
    }
  }
  lines.push('')

  const target = join(rootPath, '_index.md')
  writeFileSync(target, lines.join('\n'))
  return target
}

export const _internal = { listIndexableFiles, FILE_DESCRIPTIONS }
