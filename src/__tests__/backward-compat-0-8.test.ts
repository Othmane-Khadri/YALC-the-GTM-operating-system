import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { loadMarkdownSkill } from '../lib/skills/markdown-loader'
import { loadAllFrameworks, parseFrameworkYaml } from '../lib/frameworks/loader'

const SKILLS_DIR = join(process.cwd(), 'configs', 'skills')
const FRAMEWORKS_DIR = join(process.cwd(), 'configs', 'frameworks')

/**
 * 0.9.F backward-compat audit.
 *
 * Purpose: the 0.7.0 → 0.8.0 → 0.9.0 upgrade path stays smooth.
 * Concretely:
 *   - Every bundled 0.8.0 skill that survived the 0.9.F retirement still
 *     loads cleanly and exposes its declared capability.
 *   - Every bundled 0.9.F framework yaml parses through the 0.8.0 loader
 *     (mode default = scheduled) without errors.
 *   - The 0.9.F catalog is exactly four entries (one per archetype).
 */
describe('0.9.F backward-compat audit', () => {
  it('every surviving 0.8.0 bundled skill still loads cleanly', async () => {
    const survivors = [
      'classify-mentions',
      'classify-replies',
      'connect-provider',
      'dedupe-against-history',
      'detect-funding',
      'detect-hiring-surge',
      'detect-job-change',
      'detect-news',
      'enrich-email',
      'fetch-inbox-replies',
      'funding-feed-search',
      'icp-company-search',
      'list-recent-linkedin-posts',
      'qualify-engagers',
      'rank-and-truncate',
      'research-company',
      'score-lead',
      'scrape-post-engagers',
      'suggest-reply-action',
    ]
    for (const name of survivors) {
      const path = join(SKILLS_DIR, `${name}.md`)
      expect(existsSync(path), `${name}.md is missing`).toBe(true)
      const result = await loadMarkdownSkill(path)
      expect(result.errors, `${name} errors: ${result.errors.join(';')}`).toEqual([])
      expect(result.skill).not.toBeNull()
    }
  })

  it('every bundled framework yaml parses (and the catalog is exactly 4)', () => {
    const frameworks = readdirSync(FRAMEWORKS_DIR).filter((f) => f.endsWith('.yaml'))
    expect(frameworks.sort()).toEqual([
      'competitor-audience-mining.yaml',
      'content-calendar-builder.yaml',
      'lead-magnet-builder.yaml',
      'outreach-campaign-builder.yaml',
    ])
    for (const f of frameworks) {
      const raw = readFileSync(join(FRAMEWORKS_DIR, f), 'utf-8')
      // parse via the loader directly so we exercise the 0.7.0→0.8.0→0.9.0
      // schema evolution path (mode default, on-demand schedule absence, etc).
      const parsed = parseFrameworkYaml(join(FRAMEWORKS_DIR, f), raw)
      expect(parsed.name).toBeTruthy()
      expect(parsed.steps.length).toBeGreaterThan(0)
    }
  })

  it('loadAllFrameworks() returns exactly the 4 archetypes', () => {
    const all = loadAllFrameworks()
    const names = all.map((f) => f.name).sort()
    expect(names).toEqual([
      'competitor-audience-mining',
      'content-calendar-builder',
      'lead-magnet-builder',
      'outreach-campaign-builder',
    ])
  })

  it('a synthetic 0.7.0-style yaml with no `mode:` still parses (schedule defaults)', () => {
    const legacy = `
name: legacy-test
display_name: "Legacy"
description: "Legacy framework with no mode field"
schedule:
  cron: "0 8 * * *"
steps:
  - skill: classify-mentions
output:
  destination_choice:
    - dashboard:
        route: "/legacy"
`
    const parsed = parseFrameworkYaml('test://legacy', legacy)
    expect(parsed.mode).toBe('scheduled')
    expect(parsed.schedule.cron).toBe('0 8 * * *')
  })
})
