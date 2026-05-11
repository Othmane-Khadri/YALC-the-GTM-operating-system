/**
 * Routine types — the deterministic, rule-based proposal the Routine
 * Generator returns from `routine:propose` and the install step writes
 * to `~/.gtm-os/routine.yaml`.
 *
 * Per the C2 spec (`docs/superpowers/specs/2026-05-01-routine-generator-design.md`)
 * the shape is a versioned plain object — no class, no methods. Every
 * entry is reproducible by re-running the rule pipeline so the SPA can
 * preview the proposal before the user confirms.
 *
 * `version` is bumped when fields are renamed/removed (a migration in
 * `src/lib/onboarding/migrate.ts` handles old sidecars). Additive
 * changes (new framework, new predicate) do NOT bump the version.
 */

import type { ArchetypeId } from '../frameworks/archetypes.js'

/** A single framework slot in the proposed Routine. */
export interface RoutineFrameworkEntry {
  /** Framework name; matches a `configs/frameworks/*.yaml` `name:` field. */
  framework: string
  /**
   * Schedule the routine wants installed for this framework. Omitted for
   * `mode: on-demand` frameworks (e.g. outreach-campaign-builder, lead-magnet-builder).
   */
  schedule?: { cron: string; timezone?: string }
  /** Optional input overrides applied on top of the framework's `inputs:` defaults. */
  inputs?: Record<string, unknown>
  /** One human-readable line — *why* this framework was included. */
  rationale: string
  /**
   * True when the framework is eligible but the install must pause for an
   * upstream wizard (currently only outreach-campaign-builder waiting on a
   * locked hypothesis). The installer routes deferred entries through
   * setup Step 10 instead of running a hands-off install.
   */
  deferred?: boolean
}

/**
 * The proposed Routine. Pure data — serializable to JSON or YAML, both
 * reproducible by re-running `generateRoutine()` on the same inputs.
 */
export interface Routine {
  /** Schema version. Bump on field renames; additive changes stay at 1. */
  version: 1
  /** ISO timestamp the routine was generated at. */
  generatedAt: string
  /** Archetype set the user maps to (A/B/C/D), uppercase. */
  archetypes: Array<'A' | 'B' | 'C' | 'D'>
  /** Frameworks to install + their schedules / input overrides. */
  frameworks: RoutineFrameworkEntry[]
  /** Default landing dashboard route — written to `config.yaml.dashboard.default_route`. */
  defaultDashboard: string
  /** Generator-level notes (capability gaps, conflicts resolved). */
  notes: string[]
}

/** Helper: return the archetype's letter in uppercase for the `archetypes` field. */
export function archetypeLetter(id: ArchetypeId): 'A' | 'B' | 'C' | 'D' {
  return id.toUpperCase() as 'A' | 'B' | 'C' | 'D'
}
