/**
 * Framework runner — executes an installed framework's steps.
 *
 * Bridges the framework definition (YAML in `configs/frameworks/<name>.yaml`)
 * to the skill registry that the BackgroundAgent uses for scheduled runs.
 * Manual runs (`framework:run <name>`) and scheduled runs share the same
 * step pipeline, template substitution, and output shape.
 *
 * Step skill resolution order:
 *   1. Direct ID lookup (`step.skill`).
 *   2. Markdown-style ID lookup (`md:<step.skill>`).
 *   3. Bundled fallback — load `configs/skills/<step.skill>.md` on demand
 *      so frameworks can ship without requiring users to copy skills into
 *      `~/.gtm-os/skills/` first.
 *
 * Templates supported in step inputs:
 *   - `{{var}}` — replaced with the corresponding value from `inputs`
 *     (merged with `seed_run.override_inputs` when `seed: true`).
 *   - `{{steps[N].output}}` — replaced with the previous step's collected
 *     result rows.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import Ajv, { type ErrorObject } from 'ajv'
import { PKG_ROOT } from '../paths.js'
import { findFramework } from './loader.js'
import { loadInstalledConfig } from './registry.js'
import type { DashboardRun } from './output/dashboard-adapter.js'
import { appendRun as notionAppendRun } from './output/notion-adapter.js'
import { getSkillRegistryReady } from '../skills/registry.js'
import { loadMarkdownSkill } from '../skills/markdown-loader.js'
import { resolveSkillAlias } from '../skills/aliases.js'
import { getRegistryReady } from '../providers/registry.js'
import type { FrameworkStep, FrameworkStepEntry } from './types.js'
import { isGateStep } from './types.js'
import type { Skill, SkillContext } from '../skills/types.js'

/** Resolve the runs directory at call time so HOME-overrides in tests apply. */
function runsDirFor(name: string): string {
  return join(homedir(), '.gtm-os', 'agents', `${name}.runs`)
}

/** Process exit code emitted when a run paused at a human-gate step. */
export const EXIT_CODE_AWAITING_GATE = 30

export interface FrameworkRunOptions {
  /** Use `seed_run.override_inputs` from the framework yaml when present. */
  seed?: boolean
  /**
   * Resume a previously-paused run from a gate.
   *
   * The runner re-creates `stepOutputs` from `priorStepOutputs`, applies
   * any `payloadOverride` to the slot referenced by the gate, optionally
   * threads `rejectionReason` into the run context, and continues from
   * `startAtStep`. Used by `framework:resume`.
   */
  resume?: {
    runId: string
    /** Step index to resume at. For approve, this is the step AFTER the gate. */
    startAtStep: number
    /** Outputs of every step that ran before the gate, in execution order. */
    priorStepOutputs: unknown[]
    /** Optional edits applied to a specific prior step's output before resume. */
    payloadOverride?: { stepIndex: number; value: unknown }
    /** When set, exposed via `vars.rejection_reason` on a retry. */
    rejectionReason?: string
  }
}

export class FrameworkRunError extends Error {
  readonly step: number
  readonly stepSkill: string
  readonly partialPath: string | null
  constructor(step: number, stepSkill: string, message: string, partialPath: string | null) {
    super(`Step ${step} (${stepSkill}) failed: ${message}`)
    this.name = 'FrameworkRunError'
    this.step = step
    this.stepSkill = stepSkill
    this.partialPath = partialPath
  }
}

/**
 * Thrown when execution reaches a gate step. The CLI catches this and
 * exits with `EXIT_CODE_AWAITING_GATE` after surfacing the file path.
 */
export class FrameworkGatePauseError extends Error {
  readonly framework: string
  readonly runId: string
  readonly stepIndex: number
  readonly gateId: string
  readonly awaitingGatePath: string
  constructor(args: {
    framework: string
    runId: string
    stepIndex: number
    gateId: string
    awaitingGatePath: string
  }) {
    super(
      `Run paused at gate "${args.gateId}" (framework=${args.framework}, run=${args.runId}, step=${args.stepIndex}).`,
    )
    this.name = 'FrameworkGatePauseError'
    this.framework = args.framework
    this.runId = args.runId
    this.stepIndex = args.stepIndex
    this.gateId = args.gateId
    this.awaitingGatePath = args.awaitingGatePath
  }
}

/** Shape of the awaiting-gate sentinel persisted on disk. */
export interface AwaitingGateRecord {
  run_id: string
  framework: string
  step_index: number
  gate_id: string
  prompt: string
  payload: unknown
  prior_step_outputs: unknown[]
  inputs: Record<string, unknown>
  created_at: string
}

/** Render the cumulative output of a finished run as a flat row list. */
function flattenStepRows(stepOutputs: unknown[]): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const out of stepOutputs) {
    if (Array.isArray(out)) {
      for (const r of out) {
        if (r && typeof r === 'object') rows.push(r as Record<string, unknown>)
      }
    } else if (out && typeof out === 'object') {
      const o = out as Record<string, unknown>
      if (Array.isArray(o.rows)) {
        for (const r of o.rows) {
          if (r && typeof r === 'object') rows.push(r as Record<string, unknown>)
        }
      } else {
        rows.push(o)
      }
    }
  }
  return rows
}

/**
 * Resolve a `$file:<path>` reference to the file's text content. Used by
 * framework yamls to inject captured config files (e.g. `~/.gtm-os/icp.yaml`)
 * into a step's input at runtime — the LLM body never has to "read" a file.
 *
 * Supported path forms:
 *   - `~/...` — expanded against the current `homedir()` (HOME-isolated tests).
 *   - absolute paths — used as-is.
 *
 * Missing files resolve to an empty string; the skill body is expected to
 * handle the empty case gracefully (matches the legacy "file not present"
 * behavior the body assumed).
 */
export function resolveFileReference(ref: string): string {
  let pathPart = ref.slice('$file:'.length)
  if (pathPart.startsWith('~/')) {
    pathPart = join(homedir(), pathPart.slice(2))
  } else if (pathPart === '~') {
    pathPart = homedir()
  }
  if (!existsSync(pathPart)) return ''
  try {
    return readFileSync(pathPart, 'utf-8')
  } catch {
    return ''
  }
}

/**
 * Recursively walk an input value, substituting `{{var}}` and
 * `{{steps[N].output}}` references. Strings get string substitution; nested
 * objects / arrays get recursed. Strings prefixed with `$file:` are resolved
 * to file contents at framework-run time so prompt bodies receive the data
 * directly via `{{var}}`.
 */
export function substituteStepInput(
  value: unknown,
  vars: Record<string, unknown>,
  stepOutputs: unknown[],
): unknown {
  if (typeof value === 'string') {
    // `$file:<path>` — read the file and inject its contents as the value.
    if (value.startsWith('$file:')) {
      return resolveFileReference(value)
    }
    // Whole-value substitution — `{{steps[0].output}}` → real array.
    const stepRef = value.match(/^\{\{\s*steps\[(\d+)\]\.output\s*\}\}$/)
    if (stepRef) {
      const idx = Number(stepRef[1])
      return stepOutputs[idx] ?? null
    }
    const wholeVar = value.match(/^\{\{\s*(\w+)\s*\}\}$/)
    if (wholeVar) {
      const name = wholeVar[1]
      if (name in vars) return vars[name]
    }
    // Inline substitution — replace each occurrence inside a larger string.
    return value
      .replace(/\{\{\s*steps\[(\d+)\]\.output\s*\}\}/g, (_m, idx: string) => {
        const v = stepOutputs[Number(idx)]
        return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
      })
      .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) => {
        const v = vars[name]
        return v == null ? '' : typeof v === 'string' ? v : String(v)
      })
  }
  if (Array.isArray(value)) {
    return value.map((v) => substituteStepInput(v, vars, stepOutputs))
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substituteStepInput(v, vars, stepOutputs)
    }
    return out
  }
  return value
}

/**
 * Coerce a skill's collected output into the value the schema describes.
 *
 * The reasoning capability adapter returns `{ text: "...JSON..." }` — to
 * meaningfully validate the LLM's output we parse JSON out of `text` and
 * validate the parsed value. For other shapes we validate the value as-is.
 */
export function unwrapForValidation(out: unknown): unknown {
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    const o = out as Record<string, unknown>
    if (typeof o.text === 'string') {
      const text = o.text.trim()
      // Strip ```json ...``` fences if present.
      const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
      const candidate = fenced ? fenced[1] : text
      try {
        return JSON.parse(candidate)
      } catch {
        return o.text
      }
    }
  }
  return out
}

const sharedAjv = new Ajv({ allErrors: true, strict: false })

/**
 * Validate a step output against its skill's declared `validationSchema`.
 * Returns AJV error list on mismatch, or `null` when valid (or when the
 * skill has no schema declared / explicit `null`).
 */
export function validateStepOutput(
  skill: Skill,
  output: unknown,
): ErrorObject[] | null {
  // No-schema or explicit pass-through (`output_schema: null`) → skip.
  if (skill.validationSchema === undefined || skill.validationSchema === null) {
    return null
  }
  let validate
  try {
    validate = sharedAjv.compile(skill.validationSchema)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [{ instancePath: '', schemaPath: '', keyword: 'schema', params: {}, message: `schema compile error: ${msg}` } as ErrorObject]
  }
  const value = unwrapForValidation(output)
  const ok = validate(value)
  return ok ? null : (validate.errors ?? [])
}

/**
 * Resolve a step's skill via the registry, falling back to bundled markdown.
 *
 * Resolution order:
 *   1. Exact-match lookup against the registry (`<name>` then `md:<name>`).
 *   2. Bundled fallback (`configs/skills/<name>.md`).
 *   3. Alias map (e.g. `crustdata-icp-search` → `icp-company-search`).
 *
 * Exact-match always wins over the alias so a user can keep authoring a
 * locally-named skill that happens to collide with a deprecated alias.
 */
async function resolveStepSkill(skillId: string): Promise<Skill | null> {
  const registry = await getSkillRegistryReady()
  const direct = registry.get(skillId)
  if (direct) return direct
  const mdId = registry.get(`md:${skillId}`)
  if (mdId) return mdId
  const bundledPath = join(PKG_ROOT, 'configs', 'skills', `${skillId}.md`)
  if (existsSync(bundledPath)) {
    const result = await loadMarkdownSkill(bundledPath)
    if (result.skill) {
      registry.register(result.skill)
      return result.skill
    }
  }
  // Last resort: walk the alias table. This is what keeps user-authored
  // YAMLs that still reference renamed skills working without edits.
  const aliased = resolveSkillAlias(skillId)
  if (aliased !== skillId) {
    return resolveStepSkill(aliased)
  }
  return null
}

/** Run a single skill and collect its result events. */
async function executeSkill(
  skill: Skill,
  input: Record<string, unknown>,
  context: SkillContext,
): Promise<unknown> {
  const collected: unknown[] = []
  for await (const event of skill.execute(input, context)) {
    if (event.type === 'result') collected.push(event.data)
    if (event.type === 'error') throw new Error(event.message)
  }
  if (collected.length === 0) return null
  if (collected.length === 1) return collected[0]
  return collected
}

/** Persist a partial-or-complete run to disk and return the file path. */
function persistRun(
  framework: string,
  run: DashboardRun & { error?: { step: number; message: string } },
): string {
  const dir = runsDirFor(framework)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const stamp = run.ranAt.replace(/[:.]/g, '-')
  const file = join(dir, `${stamp}.json`)
  writeFileSync(file, JSON.stringify(run, null, 2) + '\n', 'utf-8')
  return file
}

/**
 * Execute every step of an installed framework, persisting either a
 * complete run JSON or a partial run JSON on the first failure.
 *
 * Returns the path of the run file written. Throws `FrameworkRunError`
 * when a step throws — the caller is expected to exit non-zero in that
 * case (the partial output JSON has already been persisted).
 */
export async function runFramework(
  name: string,
  opts: FrameworkRunOptions = {},
): Promise<{ path: string; run: DashboardRun }> {
  const framework = findFramework(name)
  if (!framework) {
    throw new Error(`Unknown framework: ${name}`)
  }
  const cfg = loadInstalledConfig(name)
  if (!cfg) {
    throw new Error(`Framework "${name}" is not installed`)
  }

  // Merge resolved install-time inputs with seed overrides when --seed is set.
  const vars: Record<string, unknown> = { ...cfg.inputs }
  if (opts.seed && framework.seed_run?.override_inputs) {
    Object.assign(vars, framework.seed_run.override_inputs)
  }
  if (opts.resume?.rejectionReason) {
    vars.rejection_reason = opts.resume.rejectionReason
  }

  const providers = await getRegistryReady()
  const context: SkillContext = {
    framework: null as never,
    intelligence: [],
    providers,
    userId: 'framework-runner',
  }

  // Restore any prior step outputs first so {{steps[N].output}} references
  // continue to resolve correctly after a resume. Apply the optional payload
  // override (the human's edits) to the referenced slot.
  const stepOutputs: unknown[] = opts.resume ? [...opts.resume.priorStepOutputs] : []
  if (opts.resume?.payloadOverride) {
    const { stepIndex, value } = opts.resume.payloadOverride
    if (stepIndex >= 0 && stepIndex < stepOutputs.length) {
      stepOutputs[stepIndex] = value
    }
  }
  const startAt = opts.resume ? opts.resume.startAtStep : 0
  const ranAt = new Date().toISOString()
  // Run ID: a resume reuses the original ID so the awaiting-gate / approved
  // / rejected sentinels share lineage. New runs use the run timestamp.
  const runId = opts.resume?.runId ?? ranAt.replace(/[:.]/g, '-')

  for (let i = startAt; i < framework.steps.length; i++) {
    const stepEntry: FrameworkStepEntry = framework.steps[i]
    if (isGateStep(stepEntry)) {
      // Resolve the editable payload — defaults to the immediately-previous
      // step's output, with `payload_from_step` allowing reach-back.
      const fromStep =
        stepEntry.gate.payload_from_step !== undefined
          ? stepEntry.gate.payload_from_step
          : Math.max(0, i - 1)
      const payload = stepOutputs[fromStep] ?? null
      const dir = runsDirFor(name)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const awaitingPath = join(dir, `${runId}.awaiting-gate.json`)
      const record: AwaitingGateRecord = {
        run_id: runId,
        framework: name,
        step_index: i,
        gate_id: stepEntry.gate.id,
        prompt: stepEntry.gate.prompt,
        payload,
        prior_step_outputs: stepOutputs,
        inputs: vars,
        created_at: ranAt,
      }
      writeFileSync(awaitingPath, JSON.stringify(record, null, 2) + '\n', 'utf-8')
      throw new FrameworkGatePauseError({
        framework: name,
        runId,
        stepIndex: i,
        gateId: stepEntry.gate.id,
        awaitingGatePath: awaitingPath,
      })
    }
    const step: FrameworkStep = stepEntry
    const skill = await resolveStepSkill(step.skill)
    if (!skill) {
      const partial: DashboardRun & { error: { step: number; message: string } } = {
        title: `${framework.display_name} — failed`,
        summary: `Step ${i} (${step.skill}) could not be resolved.`,
        rows: flattenStepRows(stepOutputs),
        ranAt,
        meta: { manual: !opts.seed, seed: !!opts.seed, inputs: vars, completedSteps: i },
        error: { step: i, message: `Skill "${step.skill}" not found` },
      }
      const path = persistRun(name, partial)
      throw new FrameworkRunError(i, step.skill, partial.error.message, path)
    }

    const rawInput = step.input ?? {}
    const resolvedInput = substituteStepInput(rawInput, vars, stepOutputs) as Record<string, unknown>

    try {
      const out = await executeSkill(skill, resolvedInput, context)
      const validationErrors = validateStepOutput(skill, out)
      if (validationErrors && validationErrors.length > 0) {
        const summary = validationErrors
          .slice(0, 3)
          .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
          .join('; ')
        const partial: DashboardRun & {
          error: { step: number; message: string; validation_errors: ErrorObject[] }
        } = {
          title: `${framework.display_name} — failed`,
          summary: `Step ${i} (${step.skill}) output failed schema validation.`,
          rows: flattenStepRows(stepOutputs),
          ranAt,
          meta: { manual: !opts.seed, seed: !!opts.seed, inputs: vars, completedSteps: i },
          error: {
            step: i,
            message: `Output schema validation failed: ${summary}`,
            validation_errors: validationErrors,
          },
        }
        const path = persistRun(name, partial)
        throw new FrameworkRunError(i, step.skill, partial.error.message, path)
      }
      stepOutputs.push(out)
    } catch (err) {
      if (err instanceof FrameworkRunError) throw err
      const message = err instanceof Error ? err.message : String(err)
      const partial: DashboardRun & { error: { step: number; message: string } } = {
        title: `${framework.display_name} — failed`,
        summary: `Step ${i} (${step.skill}) threw.`,
        rows: flattenStepRows(stepOutputs),
        ranAt,
        meta: { manual: !opts.seed, seed: !!opts.seed, inputs: vars, completedSteps: i },
        error: { step: i, message },
      }
      const path = persistRun(name, partial)
      throw new FrameworkRunError(i, step.skill, message, path)
    }
  }

  const finalRun: DashboardRun = {
    title: `${framework.display_name} — ${opts.seed ? 'seed run' : 'run'}`,
    summary: framework.seed_run?.description && opts.seed
      ? framework.seed_run.description
      : `Completed ${framework.steps.length} step${framework.steps.length === 1 ? '' : 's'}.`,
    rows: flattenStepRows(stepOutputs),
    ranAt,
    meta: { manual: !opts.seed, seed: !!opts.seed, inputs: vars, completedSteps: framework.steps.length },
  }

  const path = persistRun(name, finalRun)

  if (cfg.output.destination === 'notion' && cfg.output.notion_parent_page) {
    try {
      await notionAppendRun(
        { parentPageId: cfg.output.notion_parent_page },
        {
          title: finalRun.title,
          summary: finalRun.summary,
          rows: finalRun.rows,
          ranAt: finalRun.ranAt,
        },
      )
    } catch (err) {
      // Notion failures don't fail the run — the JSON is already persisted.
      // eslint-disable-next-line no-console
      console.warn(`[framework-runner] Notion appendRun failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { path, run: finalRun }
}
