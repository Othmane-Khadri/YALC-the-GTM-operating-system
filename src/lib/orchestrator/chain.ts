// ─── Chain Executor ──────────────────────────────────────────────────────────
// Reads a YAML pipeline definition and executes steps in sequence with
// conditional logic, data transforms, and checkpoint/resume capability.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import { getSkillRegistryReady } from '../skills/registry'
import { parseCondition, evaluateCondition, validateCondition } from './conditions'
import { applyPipelineTransform, validateStepTransform } from './transforms'
import type { SkillEvent, SkillContext } from '../skills/types'
import type {
  PipelineDefinition,
  PipelineCheckpoint,
  PipelineStep,
  PipelineValidationError,
  PipelineRunOptions,
  StepExecutionResult,
} from './chain-types'

const STATE_DIR = join(homedir(), '.gtm-os', 'pipelines', '.state')

// ─── Pipeline Loader ─────────────────────────────────────────────────────────

export function loadPipeline(filePath: string): PipelineDefinition {
  const resolved = filePath.startsWith('~')
    ? filePath.replace('~', homedir())
    : filePath

  if (!existsSync(resolved)) {
    throw new PipelineError(`Pipeline file not found: ${resolved}`)
  }

  const raw = readFileSync(resolved, 'utf-8')
  let parsed: unknown

  try {
    parsed = yaml.load(raw)
  } catch (err) {
    throw new PipelineError(
      `Invalid YAML in ${resolved}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  const def = parsed as PipelineDefinition
  if (!def.name || typeof def.name !== 'string') {
    throw new PipelineError('Pipeline must have a "name" field (string).')
  }
  if (!def.steps || !Array.isArray(def.steps) || def.steps.length === 0) {
    throw new PipelineError('Pipeline must have at least one step.')
  }

  return def
}

// ─── Pipeline Validation ─────────────────────────────────────────────────────

export async function validatePipeline(
  def: PipelineDefinition,
): Promise<PipelineValidationError[]> {
  const errors: PipelineValidationError[] = []
  const registry = await getSkillRegistryReady()
  const outputNames = new Map<string, number>() // output label -> step index

  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]

    // Check skill exists
    const skill = registry.get(step.skill)
    if (!skill) {
      const available = registry.list().map(s => s.id)
      errors.push({
        step: i,
        field: 'skill',
        message: `Skill "${step.skill}" not found. Available: ${available.join(', ')}`,
      })
      continue
    }

    // Check condition syntax
    if (step.condition) {
      const condErr = validateCondition(step.condition)
      if (condErr) {
        errors.push({
          step: i,
          field: 'condition',
          message: `Invalid condition at step ${i}: ${condErr}`,
        })
      }
    }

    // Check "from" references a previous step's output label
    if (step.from && i > 0) {
      let found = false
      for (let j = 0; j < i; j++) {
        const prevOutput = def.steps[j].output ?? `step_${j}`
        if (prevOutput === step.from) {
          found = true
          break
        }
      }
      // Also allow referencing a step by index label
      if (!found && !outputNames.has(step.from)) {
        // Check if it could be an implicit reference to the immediately previous step
        // (we allow this as a convenience — "from" can be the output name of any prior step)
        const prevOutputLabels = def.steps.slice(0, i).map((s, j) => s.output ?? `step_${j}`)
        errors.push({
          step: i,
          field: 'from',
          message: `Step ${i} references "${step.from}" but no prior step outputs that label. Available: ${prevOutputLabels.join(', ')}`,
        })
      }
    }

    // Check transform references valid output fields if we can determine them
    if (step.transform && typeof step.transform !== 'object') {
      errors.push({
        step: i,
        field: 'transform',
        message: `Step ${i} transform must be an object mapping source fields to target fields.`,
      })
    }

    // Track output label
    const outputLabel = step.output ?? `step_${i}`
    outputNames.set(outputLabel, i)
  }

  return errors
}

// ─── Checkpoint Management ───────────────────────────────────────────────────

function getCheckpointPath(pipelineName: string): string {
  return join(STATE_DIR, `${pipelineName}.json`)
}

function saveCheckpoint(checkpoint: PipelineCheckpoint): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const path = getCheckpointPath(checkpoint.pipelineName)
  checkpoint.updatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(checkpoint, null, 2))
}

export function loadCheckpoint(pipelineName: string): PipelineCheckpoint | null {
  const path = getCheckpointPath(pipelineName)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('rate limit') ||
      msg.includes('429') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up')
    )
  }
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Pipeline Executor ───────────────────────────────────────────────────────

export async function* executePipeline(
  options: PipelineRunOptions,
  context: SkillContext,
): AsyncGenerator<SkillEvent | { type: 'step_complete'; data: StepExecutionResult }> {
  const def = loadPipeline(options.file)

  // Validate
  const errors = await validatePipeline(def)
  if (errors.length > 0) {
    for (const err of errors) {
      yield { type: 'error', message: `Validation: Step ${err.step} [${err.field}] — ${err.message}` }
    }
    return
  }

  if (options.dryRun) {
    yield { type: 'progress', message: `[dry-run] Pipeline "${def.name}" validated (${def.steps.length} steps)`, percent: 0 }
    for (let i = 0; i < def.steps.length; i++) {
      const step = def.steps[i]
      const condTag = step.condition ? ` [if: ${step.condition}]` : ''
      const fromTag = step.from ? ` [from: ${step.from}]` : ''
      const transformTag = step.transform ? ` [transform: ${Object.keys(step.transform).join(', ')}]` : ''
      yield {
        type: 'progress',
        message: `  Step ${i}: ${step.skill}${fromTag}${condTag}${transformTag}`,
        percent: Math.round(((i + 1) / def.steps.length) * 100),
      }
    }
    yield { type: 'progress', message: `[dry-run] All steps valid. Ready to execute.`, percent: 100 }
    return
  }

  // Initialize or resume checkpoint
  const startStep = options.resumeFrom ?? 0
  let checkpoint: PipelineCheckpoint

  if (options.resumeFrom != null) {
    const existing = loadCheckpoint(def.name)
    if (existing && existing.status !== 'completed') {
      checkpoint = existing
      checkpoint.status = 'in_progress'
      yield { type: 'progress', message: `Resuming pipeline "${def.name}" from step ${startStep}`, percent: 0 }
    } else {
      checkpoint = createFreshCheckpoint(def.name, options.file)
    }
  } else {
    checkpoint = createFreshCheckpoint(def.name, options.file)
  }

  saveCheckpoint(checkpoint)

  const registry = await getSkillRegistryReady()

  // Step results keyed by output label
  const stepResults: Record<string, unknown> = { ...checkpoint.stepResults }

  for (let i = startStep; i < def.steps.length; i++) {
    const step = def.steps[i]
    const skill = registry.get(step.skill)

    if (!skill) {
      const msg = `Skill "${step.skill}" not found at step ${i}`
      checkpoint.status = 'failed'
      checkpoint.error = msg
      saveCheckpoint(checkpoint)
      yield { type: 'error', message: msg }
      return
    }

    checkpoint.currentStep = i

    // Resolve input from previous steps
    let resolvedInput: Record<string, unknown> = { ...(step.input ?? {}) }

    if (step.from) {
      const previousOutput = stepResults[step.from]
      if (previousOutput !== undefined) {
        resolvedInput = applyPipelineTransform(
          previousOutput,
          resolvedInput,
          step.transform,
          skill.inputSchema,
        )
      }
    } else if (i > 0) {
      // Auto-chain: use previous step's output
      const prevLabel = def.steps[i - 1].output ?? `step_${i - 1}`
      const previousOutput = stepResults[prevLabel]
      if (previousOutput !== undefined) {
        resolvedInput = applyPipelineTransform(
          previousOutput,
          resolvedInput,
          step.transform,
          skill.inputSchema,
        )
      }
    }

    // Evaluate condition
    if (step.condition) {
      const condNode = parseCondition(step.condition)
      const condData = mergeConditionContext(resolvedInput, stepResults)
      const pass = evaluateCondition(condNode, condData)

      if (!pass) {
        const result: StepExecutionResult = {
          stepIndex: i,
          skillId: step.skill,
          status: 'skipped',
          data: null,
          duration: 0,
          skippedReason: `Condition not met: ${step.condition}`,
        }

        const outputLabel = step.output ?? `step_${i}`
        stepResults[outputLabel] = null
        checkpoint.stepResults = stepResults
        checkpoint.completedSteps.push(i)
        saveCheckpoint(checkpoint)

        yield {
          type: 'progress',
          message: `Step ${i}: ${step.skill} — SKIPPED (${step.condition})`,
          percent: Math.round(((i + 1) / def.steps.length) * 100),
        }
        yield { type: 'step_complete', data: result }
        continue
      }
    }

    // Execute with retry
    const maxRetries = step.retries ?? 3
    let lastError: Error | null = null
    let stepResult: unknown = null
    let succeeded = false
    const stepStart = Date.now()

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000)
        yield {
          type: 'progress',
          message: `  Retry ${attempt}/${maxRetries} for step ${i} (${step.skill}) after ${delay}ms...`,
          percent: Math.round(((i) / def.steps.length) * 100),
        }
        await sleep(delay)
      }

      try {
        yield {
          type: 'progress',
          message: `Step ${i}: ${step.skill}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`,
          percent: Math.round(((i) / def.steps.length) * 100),
        }

        for await (const event of skill.execute(resolvedInput, context)) {
          if (event.type === 'result') {
            stepResult = event.data
          }
          yield event
        }

        succeeded = true
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (!isRetryableError(err) || attempt === maxRetries) {
          break
        }
      }
    }

    const stepDuration = Date.now() - stepStart

    if (!succeeded) {
      const msg = `Step ${i} (${step.skill}) failed: ${lastError?.message ?? 'unknown error'}`
      checkpoint.status = 'failed'
      checkpoint.error = msg
      saveCheckpoint(checkpoint)

      const result: StepExecutionResult = {
        stepIndex: i,
        skillId: step.skill,
        status: 'failed',
        data: null,
        duration: stepDuration,
        error: lastError?.message,
      }

      yield { type: 'error', message: msg }
      yield { type: 'step_complete', data: result }
      return
    }

    // Save step result
    const outputLabel = step.output ?? `step_${i}`
    stepResults[outputLabel] = stepResult
    checkpoint.stepResults = stepResults
    checkpoint.completedSteps.push(i)
    saveCheckpoint(checkpoint)

    const result: StepExecutionResult = {
      stepIndex: i,
      skillId: step.skill,
      status: 'completed',
      data: stepResult,
      duration: stepDuration,
    }

    yield { type: 'step_complete', data: result }
  }

  checkpoint.status = 'completed'
  saveCheckpoint(checkpoint)

  yield {
    type: 'progress',
    message: `Pipeline "${def.name}" completed: ${def.steps.length} steps`,
    percent: 100,
  }

  yield {
    type: 'result',
    data: {
      pipelineName: def.name,
      totalSteps: def.steps.length,
      completedSteps: checkpoint.completedSteps.length,
      results: stepResults,
    },
  }
}

// ─── Pipeline Listing ────────────────────────────────────────────────────────

export function listPipelines(): Array<{ name: string; file: string; description: string; steps: number }> {
  const dirs = [
    join(homedir(), '.gtm-os', 'pipelines'),
    join(process.cwd(), 'configs', 'pipelines'),
  ]

  const pipelines: Array<{ name: string; file: string; description: string; steps: number }> = []

  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter(
      (f: string) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.startsWith('.'),
    )
    for (const file of files) {
      const fullPath = join(dir, file)
      try {
        const def = loadPipeline(fullPath)
        pipelines.push({
          name: def.name,
          file: fullPath,
          description: def.description ?? '',
          steps: def.steps.length,
        })
      } catch {
        // Skip invalid files
      }
    }
  }

  return pipelines
}

// ─── Pipeline Status ─────────────────────────────────────────────────────────

export function getPipelineStatus(
  name: string,
): PipelineCheckpoint | null {
  return loadCheckpoint(name)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFreshCheckpoint(name: string, file: string): PipelineCheckpoint {
  return {
    pipelineName: name,
    pipelineFile: file,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    currentStep: 0,
    completedSteps: [],
    stepResults: {},
    status: 'in_progress',
  }
}

function mergeConditionContext(
  input: Record<string, unknown>,
  allResults: Record<string, unknown>,
): Record<string, unknown> {
  // Flatten all step results into a single context for condition evaluation
  const ctx: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(allResults)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(ctx, val)
    }
    ctx[key] = val
  }
  Object.assign(ctx, input)
  return ctx
}

export class PipelineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PipelineError'
  }
}
