/**
 * Archetype preference reader for `~/.gtm-os/config.yaml`.
 *
 * The CLI/SPA both want to know whether the user has pinned an archetype
 * (a/b/c/d) so /today can redirect to the matching dashboard. This is a
 * deliberately tiny reader — we don't pull the full `loadConfig` schema
 * because that path mutates singleton service state and validates an
 * unrelated set of fields.
 *
 * Schema (best-effort, all fields optional):
 *
 *   archetype: a            # one of a/b/c/d (case-insensitive)
 *
 * Missing file, parse errors, and unknown values all resolve to null —
 * the consumer falls back to /today.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { isArchetypeId, type ArchetypeId } from '../frameworks/archetypes.js'

export interface ReadArchetypePrefOptions {
  /** Override $HOME for hermetic tests. */
  homeOverride?: string
}

export function configYamlPath(opts: ReadArchetypePrefOptions = {}): string {
  const home = opts.homeOverride ?? process.env.HOME ?? homedir()
  return join(home, '.gtm-os', 'config.yaml')
}

/**
 * Read the user's pinned archetype from `~/.gtm-os/config.yaml`.
 *
 * Returns the archetype id ('a' | 'b' | 'c' | 'd') when set and valid,
 * otherwise null.
 */
export function readArchetypePreference(
  opts: ReadArchetypePrefOptions = {},
): ArchetypeId | null {
  const path = configYamlPath(opts)
  if (!existsSync(path)) return null
  try {
    const parsed = yaml.load(readFileSync(path, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return null
    const raw = (parsed as Record<string, unknown>).archetype
    if (typeof raw !== 'string') return null
    const lower = raw.trim().toLowerCase()
    return isArchetypeId(lower) ? (lower as ArchetypeId) : null
  } catch {
    return null
  }
}
