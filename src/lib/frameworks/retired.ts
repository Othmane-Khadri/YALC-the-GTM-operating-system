/**
 * Retired framework registry.
 *
 * Frameworks that shipped in 0.7.0 / 0.8.0 but were replaced by an
 * archetype in 0.9.F live here. The yaml file is no longer in
 * `configs/frameworks/`, but a user who already installed one of these
 * names on 0.8.0 still has the agent yaml under `~/.gtm-os/agents/<name>.yaml`
 * — we don't auto-delete that. Instead:
 *
 *   - `framework:list` shows the retired entry with status
 *     `retired (replaced by <archetype>)`.
 *   - `doctor` emits a single WARN per installed retired framework so the
 *     user is reminded to migrate to the replacement archetype.
 *   - `framework:run` continues to fail gracefully because the loader
 *     resolves to null and the runner emits a clear error.
 *
 * Aliases are scheduled for removal in 1.0.0.
 */

export interface RetiredFramework {
  /** The deprecated framework name. */
  name: string
  /** The archetype that replaces its functionality. */
  replacement: string
  /** Optional one-line note shown in `framework:list`. */
  note?: string
}

export const RETIRED_FRAMEWORKS: RetiredFramework[] = [
  {
    name: 'daily-competitor-monitoring',
    replacement: 'competitor-audience-mining',
    note: 'LinkedIn-only competitor mining replaces the Reddit/web scrape pattern.',
  },
  {
    name: 'weekly-engagement-harvest',
    replacement: 'competitor-audience-mining',
    note: 'Audience mining covers post engagement scraping.',
  },
  {
    name: 'daily-icp-signal-detection',
    replacement: 'outreach-campaign-builder',
    note: 'Signal-driven outreach is now the on-demand campaign builder.',
  },
  {
    name: 'inbound-reply-triage',
    replacement: 'outreach-campaign-builder',
    note: 'Inbound triage is collapsed into the on-demand campaign builder.',
  },
  {
    name: 'weekly-content-radar',
    replacement: 'content-calendar-builder',
    note: 'LinkedIn-trending content radar now drives the content calendar.',
  },
  {
    name: 'daily-funded-companies',
    replacement: 'outreach-campaign-builder',
    note: 'Funded-company prospecting runs as an on-demand outreach campaign.',
  },
]

const RETIRED_INDEX = new Map(RETIRED_FRAMEWORKS.map((r) => [r.name, r]))

/** Look up a retired framework by name. Returns null when not retired. */
export function findRetiredFramework(name: string): RetiredFramework | null {
  return RETIRED_INDEX.get(name) ?? null
}

/** True when the framework name is retired. */
export function isRetiredFramework(name: string): boolean {
  return RETIRED_INDEX.has(name)
}
