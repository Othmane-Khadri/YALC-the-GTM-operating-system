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

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { PKG_ROOT } from '../paths.js'
import { findFramework } from './loader.js'
import { loadInstalledConfig } from './registry.js'
import type { DashboardRun } from './output/dashboard-adapter.js'
import { appendRun as notionAppendRun } from './output/notion-adapter.js'
import { getSkillRegistryReady } from '../skills/registry.js'
import { loadMarkdownSkill } from '../skills/markdown-loader.js'
import { getRegistryReady } from '../providers/registry.js'
import type { FrameworkStep } from './types.js'
import type { Skill, SkillContext } from '../skills/types.js'

/** Resolve the runs directory at call time so HOME-overrides in tests apply. */
function runsDirFor(name: string): string {
  return join(homedir(), '.gtm-os', 'agents', `${name}.runs`)
}

export interface FrameworkRunOptions {
  /** Use `seed_run.override_inputs` from the framework yaml when present. */
  seed?: boolean
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
 * Recursively walk an input value, substituting `{{var}}` and
 * `{{steps[N].output}}` references. Strings get string substitution; nested
 * objects / arrays get recursed.
 */
export function substituteStepInput(
  value: unknown,
  vars: Record<string, unknown>,
  stepOutputs: unknown[],
): unknown {
  if (typeof value === 'string') {
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

/** Resolve a step's skill via the registry, falling back to bundled markdown. */
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

  const providers = await getRegistryReady()
  const context: SkillContext = {
    framework: null as never,
    intelligence: [],
    providers,
    userId: 'framework-runner',
  }

  const stepOutputs: unknown[] = []
  const ranAt = new Date().toISOString()

  for (let i = 0; i < framework.steps.length; i++) {
    const step: FrameworkStep = framework.steps[i]
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
      stepOutputs.push(out)
    } catch (err) {
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
