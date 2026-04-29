/**
 * Skill name aliases.
 *
 * When a skill is renamed (e.g. `crustdata-icp-search` →
 * `icp-company-search`) we keep the old name resolvable so user-authored
 * framework yamls and shared snippets keep working. The first time an
 * alias is hit at runtime we emit a one-shot deprecation WARN; subsequent
 * lookups stay quiet.
 *
 * Aliases are scheduled for removal in 1.0.0.
 */

export const SKILL_ALIASES: Record<string, string> = {
  'crustdata-icp-search': 'icp-company-search',
  'crustdata-funding-feed': 'detect-funding',
}

/**
 * Skills retired in 0.9.F (Reddit-only — no archetype consumes them).
 *
 * Lookups against any of these names emit a one-shot WARN and resolve to
 * `null` — the framework runner surfaces a clear error so the user knows
 * the retired framework that referenced them needs to migrate.
 */
export const RETIRED_SKILLS: Record<string, string> = {
  'scrape-reddit-keyword': 'no-op (Reddit-only skill retired in 0.9.F; no replacement)',
  'scrape-community-feed': 'no-op (Reddit-only skill retired in 0.9.F; no replacement)',
}

const _retiredWarned = new Set<string>()

/**
 * Emit a one-shot WARN for a retired skill name and return true. Returns
 * false when the name isn't retired so callers can proceed to normal
 * resolution.
 */
export function noteRetiredSkill(name: string): boolean {
  const replacement = RETIRED_SKILLS[name]
  if (!replacement) return false
  if (!_retiredWarned.has(name)) {
    _retiredWarned.add(name)
    // eslint-disable-next-line no-console
    console.warn(
      `[skill-alias] Skill name '${name}' was retired in 0.9.F: ${replacement}.`,
    )
  }
  return true
}

/** Test hook — drops both alias + retired WARN dedup sets. */
export function _resetSkillRetiredWarnings(): void {
  _retiredWarned.clear()
}

/** Track which alias names we've already warned for, so the WARN fires once. */
const _warned = new Set<string>()

/**
 * Resolve a possibly-aliased skill name to its canonical form. Emits a
 * one-time WARN to stderr the first time a deprecated alias is hit.
 *
 * Returns the input unchanged when no alias matches — the caller should
 * then perform its normal registry lookup.
 */
export function resolveSkillAlias(name: string): string {
  const target = SKILL_ALIASES[name]
  if (!target) return name
  if (!_warned.has(name)) {
    _warned.add(name)
    // eslint-disable-next-line no-console
    console.warn(
      `[skill-alias] Skill name '${name}' is deprecated; use '${target}'. Will be removed in 1.0.0.`,
    )
  }
  return target
}

/** Test hook — drops the WARN dedup set so a fresh run can re-trigger warnings. */
export function _resetSkillAliasWarnings(): void {
  _warned.clear()
}
