/**
 * Framework definition loader.
 *
 * Reads bundled definitions from `configs/frameworks/*.yaml` AND
 * user-installed definitions from `~/.gtm-os/frameworks/*.yaml`.
 *
 * Validation is strict — malformed YAML or missing required fields throw
 * an Error tagged with the source file path so the user can fix the
 * specific definition instead of getting a generic "bad framework" error.
 *
 * This module never loads installed runtime state (that lives in
 * `~/.gtm-os/agents/<name>.yaml` and is read by `registry.ts`).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { homedir } from 'node:os'
import { PKG_ROOT } from '../paths.js'
import type {
  FrameworkDefinition,
  FrameworkInput,
  FrameworkMode,
  FrameworkOutput,
  FrameworkOutputOption,
  FrameworkRequires,
  FrameworkSchedule,
  FrameworkSeedRun,
  FrameworkStepEntry,
  GateSurface,
  RecommendedWhenClauses,
} from './types.js'

const BUNDLED_DIR = join(PKG_ROOT, 'configs', 'frameworks')
const USER_DIR = join(homedir(), '.gtm-os', 'frameworks')

/** Thrown when a definition file is invalid. Carries the source path. */
export class FrameworkDefinitionError extends Error {
  readonly sourcePath: string
  constructor(sourcePath: string, message: string) {
    super(`[${sourcePath}] ${message}`)
    this.name = 'FrameworkDefinitionError'
    this.sourcePath = sourcePath
  }
}

/** Parse a single YAML file into a FrameworkDefinition. */
export function parseFrameworkYaml(sourcePath: string, raw: string): FrameworkDefinition {
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new FrameworkDefinitionError(sourcePath, `YAML parse failed: ${msg}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, 'Top-level must be a YAML mapping')
  }
  const r = parsed as Record<string, unknown>

  const name = requireString(sourcePath, r, 'name')
  const display_name = requireString(sourcePath, r, 'display_name')
  const description = requireString(sourcePath, r, 'description')

  const requires = parseRequires(sourcePath, r['requires'])
  const recommended_when = parseRecommendedWhen(sourcePath, r['recommended_when'])
  const inputs = parseInputs(sourcePath, r['inputs'])
  const mode = parseMode(sourcePath, r['mode'])
  const schedule = parseSchedule(sourcePath, r['schedule'], mode)
  const steps = parseSteps(sourcePath, r['steps'])
  const output = parseOutput(sourcePath, r['output'])
  const seed_run = parseSeedRun(sourcePath, r['seed_run'])

  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) {
    throw new FrameworkDefinitionError(
      sourcePath,
      `name "${name}" must be lowercase alphanumerics + hyphens, 2-64 chars`,
    )
  }

  return {
    name,
    display_name,
    description,
    requires,
    recommended_when,
    inputs,
    mode,
    schedule,
    steps,
    output,
    seed_run,
    _sourcePath: sourcePath,
  }
}

/**
 * Parse the optional `mode` field. Defaults to `scheduled` for backward
 * compatibility with 0.7.0 / 0.8.0 framework yamls that pre-date the field.
 */
function parseMode(sourcePath: string, raw: unknown): FrameworkMode {
  if (raw === undefined || raw === null) return 'scheduled'
  if (raw !== 'scheduled' && raw !== 'on-demand') {
    throw new FrameworkDefinitionError(
      sourcePath,
      `"mode" must be "scheduled" or "on-demand" (got ${JSON.stringify(raw)})`,
    )
  }
  return raw
}

function requireString(sourcePath: string, r: Record<string, unknown>, key: string): string {
  const v = r[key]
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new FrameworkDefinitionError(sourcePath, `Missing required string field "${key}"`)
  }
  return v
}

function parseRequires(sourcePath: string, raw: unknown): FrameworkRequires {
  if (raw == null) return {}
  if (typeof raw !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, '"requires" must be a mapping')
  }
  const r = raw as Record<string, unknown>
  const out: FrameworkRequires = {}
  if (r.providers !== undefined) {
    if (!Array.isArray(r.providers) || !r.providers.every((p) => typeof p === 'string')) {
      throw new FrameworkDefinitionError(sourcePath, '"requires.providers" must be a string array')
    }
    out.providers = r.providers as string[]
  }
  if (r.any_of_keys !== undefined) {
    if (!Array.isArray(r.any_of_keys) || !r.any_of_keys.every((p) => typeof p === 'string')) {
      throw new FrameworkDefinitionError(sourcePath, '"requires.any_of_keys" must be a string array')
    }
    out.any_of_keys = r.any_of_keys as string[]
  }
  if (r.context_fields !== undefined) {
    if (
      !Array.isArray(r.context_fields) ||
      !r.context_fields.every((p) => typeof p === 'string')
    ) {
      throw new FrameworkDefinitionError(
        sourcePath,
        '"requires.context_fields" must be a string array',
      )
    }
    out.context_fields = r.context_fields as string[]
  }
  return out
}

function parseRecommendedWhen(
  sourcePath: string,
  raw: unknown,
): RecommendedWhenClauses | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, '"recommended_when" must be a mapping')
  }
  const r = raw as Record<string, unknown>
  const out: RecommendedWhenClauses = {}
  if ('has_competitors_in_context' in r) out.has_competitors_in_context = !!r.has_competitors_in_context
  if ('has_provider' in r) {
    if (typeof r.has_provider !== 'string') {
      throw new FrameworkDefinitionError(sourcePath, '"recommended_when.has_provider" must be a string')
    }
    out.has_provider = r.has_provider
  }
  if ('not_has_active_framework' in r) {
    if (typeof r.not_has_active_framework !== 'string') {
      throw new FrameworkDefinitionError(
        sourcePath,
        '"recommended_when.not_has_active_framework" must be a string',
      )
    }
    out.not_has_active_framework = r.not_has_active_framework
  }
  if ('has_icp_segments' in r) out.has_icp_segments = !!r.has_icp_segments
  if ('has_target_communities' in r) out.has_target_communities = !!r.has_target_communities
  if ('has_recent_linkedin_posts' in r) out.has_recent_linkedin_posts = !!r.has_recent_linkedin_posts
  return out
}

function parseInputs(sourcePath: string, raw: unknown): FrameworkInput[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new FrameworkDefinitionError(sourcePath, '"inputs" must be a list')
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new FrameworkDefinitionError(sourcePath, `inputs[${i}] must be a mapping`)
    }
    const it = item as Record<string, unknown>
    if (typeof it.name !== 'string' || it.name.length === 0) {
      throw new FrameworkDefinitionError(sourcePath, `inputs[${i}].name is required`)
    }
    if (typeof it.description !== 'string') {
      throw new FrameworkDefinitionError(sourcePath, `inputs[${i}].description is required`)
    }
    const def = it.default
    if (
      def !== undefined &&
      def !== null &&
      typeof def !== 'string' &&
      typeof def !== 'number' &&
      !(Array.isArray(def) && def.every((d) => typeof d === 'string'))
    ) {
      throw new FrameworkDefinitionError(
        sourcePath,
        `inputs[${i}].default must be string | number | string[] | null`,
      )
    }
    return {
      name: it.name,
      description: it.description,
      default: (def ?? null) as FrameworkInput['default'],
    }
  })
}

function parseSchedule(
  sourcePath: string,
  raw: unknown,
  mode: FrameworkMode,
): FrameworkSchedule {
  // For `mode: on-demand`, the schedule block is optional — and a `cron`
  // value, if present, is rejected. For `mode: scheduled` (the default), the
  // legacy contract holds: a non-empty `schedule.cron` is required.
  if (raw == null) {
    if (mode === 'on-demand') return {}
    throw new FrameworkDefinitionError(sourcePath, '"schedule" must be a mapping')
  }
  if (typeof raw !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, '"schedule" must be a mapping')
  }
  const r = raw as Record<string, unknown>
  const out: FrameworkSchedule = {}
  if (r.cron !== undefined) {
    if (typeof r.cron !== 'string' || r.cron.split(/\s+/).length !== 5) {
      throw new FrameworkDefinitionError(
        sourcePath,
        '"schedule.cron" must be a 5-field cron expression',
      )
    }
    if (mode === 'on-demand') {
      throw new FrameworkDefinitionError(
        sourcePath,
        'on-demand frameworks must not declare "schedule.cron"',
      )
    }
    out.cron = r.cron
  } else if (mode === 'scheduled') {
    throw new FrameworkDefinitionError(
      sourcePath,
      'scheduled frameworks must declare "schedule.cron"',
    )
  }
  if (r.timezone !== undefined) {
    if (typeof r.timezone !== 'string') {
      throw new FrameworkDefinitionError(sourcePath, '"schedule.timezone" must be a string')
    }
    out.timezone = r.timezone
  }
  return out
}

function parseSteps(sourcePath: string, raw: unknown): FrameworkStepEntry[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new FrameworkDefinitionError(sourcePath, '"steps" must be a non-empty list')
  }
  return raw.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new FrameworkDefinitionError(sourcePath, `steps[${i}] must be a mapping`)
    }
    const it = item as Record<string, unknown>
    // Human-gate step — `{ gate: { id, prompt, surface, payload_from_step? } }`.
    if ('gate' in it) {
      const gateRaw = it.gate
      if (!gateRaw || typeof gateRaw !== 'object' || Array.isArray(gateRaw)) {
        throw new FrameworkDefinitionError(sourcePath, `steps[${i}].gate must be a mapping`)
      }
      const g = gateRaw as Record<string, unknown>
      if (typeof g.id !== 'string' || g.id.length === 0) {
        throw new FrameworkDefinitionError(sourcePath, `steps[${i}].gate.id is required`)
      }
      if (typeof g.prompt !== 'string' || g.prompt.length === 0) {
        throw new FrameworkDefinitionError(sourcePath, `steps[${i}].gate.prompt is required`)
      }
      if (g.surface !== 'ui-today' && g.surface !== 'ui-modal') {
        throw new FrameworkDefinitionError(
          sourcePath,
          `steps[${i}].gate.surface must be "ui-today" or "ui-modal"`,
        )
      }
      let payloadFromStep: number | undefined
      if (g.payload_from_step !== undefined) {
        if (typeof g.payload_from_step !== 'number' || !Number.isInteger(g.payload_from_step) || g.payload_from_step < 0) {
          throw new FrameworkDefinitionError(
            sourcePath,
            `steps[${i}].gate.payload_from_step must be a non-negative integer`,
          )
        }
        if (g.payload_from_step >= i) {
          throw new FrameworkDefinitionError(
            sourcePath,
            `steps[${i}].gate.payload_from_step must reference an earlier step`,
          )
        }
        payloadFromStep = g.payload_from_step
      }
      return {
        gate: {
          id: g.id,
          prompt: g.prompt,
          surface: g.surface as GateSurface,
          ...(payloadFromStep !== undefined ? { payload_from_step: payloadFromStep } : {}),
        },
      }
    }
    // Skill step — existing shape, unchanged.
    if (typeof it.skill !== 'string' || it.skill.length === 0) {
      throw new FrameworkDefinitionError(sourcePath, `steps[${i}].skill is required`)
    }
    const input = it.input
    if (input !== undefined && (typeof input !== 'object' || Array.isArray(input))) {
      throw new FrameworkDefinitionError(sourcePath, `steps[${i}].input must be a mapping when present`)
    }
    return {
      skill: it.skill,
      input: (input as Record<string, unknown>) ?? {},
    }
  })
}

function parseOutput(sourcePath: string, raw: unknown): FrameworkOutput {
  if (!raw || typeof raw !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, '"output" must be a mapping')
  }
  const r = raw as Record<string, unknown>
  const choices = r.destination_choice
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new FrameworkDefinitionError(
      sourcePath,
      '"output.destination_choice" must be a non-empty list',
    )
  }
  const parsed: FrameworkOutputOption[] = choices.map((item, i) => {
    if (!item || typeof item !== 'object') {
      throw new FrameworkDefinitionError(
        sourcePath,
        `output.destination_choice[${i}] must be a mapping`,
      )
    }
    const it = item as Record<string, unknown>
    const opt: FrameworkOutputOption = {}
    if (it.notion) opt.notion = it.notion as FrameworkOutputOption['notion']
    if (it.dashboard) opt.dashboard = it.dashboard as FrameworkOutputOption['dashboard']
    if (!opt.notion && !opt.dashboard) {
      throw new FrameworkDefinitionError(
        sourcePath,
        `output.destination_choice[${i}] must include "notion" or "dashboard"`,
      )
    }
    return opt
  })
  return { destination_choice: parsed }
}

function parseSeedRun(sourcePath: string, raw: unknown): FrameworkSeedRun | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'object') {
    throw new FrameworkDefinitionError(sourcePath, '"seed_run" must be a mapping')
  }
  const r = raw as Record<string, unknown>
  const out: FrameworkSeedRun = {}
  if (r.description !== undefined) {
    if (typeof r.description !== 'string') {
      throw new FrameworkDefinitionError(sourcePath, '"seed_run.description" must be a string')
    }
    out.description = r.description
  }
  if (r.override_inputs !== undefined) {
    if (typeof r.override_inputs !== 'object' || Array.isArray(r.override_inputs)) {
      throw new FrameworkDefinitionError(
        sourcePath,
        '"seed_run.override_inputs" must be a mapping',
      )
    }
    out.override_inputs = r.override_inputs as Record<string, unknown>
  }
  return out
}

/** Resolve the bundled-frameworks directory. Public for tests. */
export function bundledFrameworksDir(): string {
  return BUNDLED_DIR
}

/** Resolve the user-frameworks directory (`~/.gtm-os/frameworks`). */
export function userFrameworksDir(): string {
  return USER_DIR
}

/** Read every `.yaml` file in a directory and parse it. Missing dir → []. */
function loadDir(dir: string): FrameworkDefinition[] {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir).filter(
    (f) => f.endsWith('.yaml') || f.endsWith('.yml'),
  )
  const out: FrameworkDefinition[] = []
  for (const fname of entries) {
    const full = join(dir, fname)
    const raw = readFileSync(full, 'utf-8')
    out.push(parseFrameworkYaml(full, raw))
  }
  return out
}

/**
 * Load every framework definition known to YALC.
 * Bundled definitions are loaded first; user-installed definitions follow.
 * If a user file shadows a bundled name, the user copy wins (override).
 */
export function loadAllFrameworks(): FrameworkDefinition[] {
  const bundled = loadDir(BUNDLED_DIR)
  const user = loadDir(USER_DIR)
  const map = new Map<string, FrameworkDefinition>()
  for (const f of bundled) map.set(f.name, f)
  for (const f of user) map.set(f.name, f)
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Look up one framework by name. Returns null if absent. */
export function findFramework(name: string): FrameworkDefinition | null {
  return loadAllFrameworks().find((f) => f.name === name) ?? null
}
