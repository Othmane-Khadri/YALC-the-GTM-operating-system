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
