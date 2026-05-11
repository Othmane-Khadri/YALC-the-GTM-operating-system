/**
 * `routine:propose` and `routine:install` CLI commands.
 *
 * `routine:propose` runs the deterministic generator and prints the
 * proposal. `--json` switches to JSON for SPA consumption.
 *
 * `routine:install` re-runs the generator (so the user can't drift on a
 * stale proposal), then applies. Defaults to interactive confirmation;
 * `--yes` skips the prompt.
 *
 * Surface mirrors `adapters:list` / `provider:install` — diagnostics
 * wrapper at the call site, this module returns `{ exitCode, output }`.
 */

import { confirm } from '@inquirer/prompts'
import {
  gatherEnvironment,
  loadCompanyContext,
} from '../../lib/frameworks/recommend.js'
import { generateRoutine } from '../../lib/routine/generator.js'
import { installRoutine, type InstallOptions } from '../../lib/routine/installer.js'
import type { Routine, RoutineFrameworkEntry } from '../../lib/routine/types.js'
import { readArchetypePreference } from '../../lib/config/archetype-pref.js'
import { loadOutboundHypothesis } from '../../lib/frameworks/outbound-hypothesis.js'
import { getRegistryReady } from '../../lib/providers/registry.js'

export interface ProposeOptions {
  /** When true, emit JSON instead of the human-readable preview. */
  json?: boolean
  /**
   * Test/hermetic override — when provided, skips the live registry +
   * env scan and uses these values verbatim.
   */
  inputs?: {
    capabilitiesAvailable: string[]
    envHasAnthropic: boolean
    archetype: 'a' | 'b' | 'c' | 'd' | null
    context: ReturnType<typeof loadCompanyContext>
    hypothesisLocked: boolean
  }
}

export interface ProposeResult {
  exitCode: number
  output: string
  routine: Routine
}

/** Resolve the live capability set (active providers only). */
async function resolveCapabilities(): Promise<string[]> {
  try {
    const reg = await getRegistryReady()
    return reg.getAll().filter((p) => p.status === 'active').map((p) => p.id)
  } catch {
    return []
  }
}

/**
 * Build the generator input from the live environment. Centralized here
 * so both `propose` and `install` see exactly the same inputs.
 */
async function gatherInputs(): Promise<{
  capabilitiesAvailable: string[]
  envHasAnthropic: boolean
  archetype: 'a' | 'b' | 'c' | 'd' | null
  context: ReturnType<typeof loadCompanyContext>
  hypothesisLocked: boolean
}> {
  const env = gatherEnvironment()
  const capabilities = await resolveCapabilities()
  const hypothesis = loadOutboundHypothesis('outreach-campaign-builder')
  return {
    capabilitiesAvailable: capabilities,
    envHasAnthropic: env.envKeys.includes('ANTHROPIC_API_KEY'),
    archetype: readArchetypePreference(),
    context: env.context,
    hypothesisLocked: !!(hypothesis && hypothesis.icp_segment.length > 0),
  }
}

/** Pretty-print a single framework entry. */
function fmtEntry(entry: RoutineFrameworkEntry, idx: number): string {
  const lines: string[] = []
  const head = `  ${idx + 1}. ${entry.framework}${entry.deferred ? '  (deferred)' : ''}`
  lines.push(head)
  if (entry.schedule?.cron) {
    lines.push(`     Schedule: ${entry.schedule.cron}${entry.schedule.timezone ? ` (${entry.schedule.timezone})` : ''}`)
  } else {
    lines.push('     Schedule: on-demand')
  }
  lines.push(`     Why:      ${entry.rationale}`)
  return lines.join('\n')
}

/** Render the human-readable preview. */
function renderHuman(routine: Routine): string {
  const lines: string[] = []
  lines.push('')
  lines.push(`Proposed Routine (archetypes: ${routine.archetypes.length === 0 ? 'none' : routine.archetypes.join(', ')})`)
  lines.push('')
  if (routine.frameworks.length === 0) {
    lines.push('  No frameworks matched your current setup.')
  } else {
    routine.frameworks.forEach((e, i) => lines.push(fmtEntry(e, i)))
  }
  lines.push('')
  lines.push(`  Default dashboard: ${routine.defaultDashboard}`)
  if (routine.notes.length > 0) {
    lines.push('')
    lines.push('  Notes:')
    for (const n of routine.notes) lines.push(`    - ${n}`)
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * `routine:propose` — deterministic proposal preview.
 * Exit code 0 normally, exit 2 when no Anthropic key is set (signals
 * "nothing to install" to the SPA).
 */
export async function runRoutinePropose(opts: ProposeOptions = {}): Promise<ProposeResult> {
  const inputs = opts.inputs ?? (await gatherInputs())
  const routine = generateRoutine(inputs)
  const output = opts.json ? JSON.stringify(routine) : renderHuman(routine)
  const exitCode = inputs.envHasAnthropic ? 0 : 2
  return { exitCode, output, routine }
}

export interface InstallCliOptions extends Pick<InstallOptions, 'only' | 'dryRun' | 'installFramework'> {
  /** When true, skip the interactive confirmation. */
  yes?: boolean
  /** Test override mirroring ProposeOptions.inputs. */
  inputs?: ProposeOptions['inputs']
  /** When true, suppress the interactive prompt (tests). */
  noPrompt?: boolean
}

export interface InstallCliResult {
  exitCode: number
  output: string
}

/**
 * `routine:install` — recompute and apply.
 * Always re-runs the generator so the proposal can't drift. Confirmation
 * prompt unless `--yes` (or `--no-prompt` / a test inputs stub) is set.
 */
export async function runRoutineInstall(opts: InstallCliOptions = {}): Promise<InstallCliResult> {
  const inputs = opts.inputs ?? (await gatherInputs())
  const routine = generateRoutine(inputs)
  const lines: string[] = [renderHuman(routine)]

  if (routine.frameworks.length === 0) {
    lines.push('Nothing to install.')
    return { exitCode: 0, output: lines.join('\n') }
  }

  if (!opts.yes && !opts.noPrompt) {
    const proceed = await confirm({
      message: 'Install this routine?',
      default: true,
    })
    if (!proceed) {
      lines.push('Cancelled.')
      return { exitCode: 0, output: lines.join('\n') }
    }
  }

  const result = await installRoutine(routine, {
    only: opts.only,
    dryRun: opts.dryRun,
    installFramework: opts.installFramework,
  })
  lines.push('')
  if (result.installed.length > 0) {
    lines.push(`Installed: ${result.installed.join(', ')}`)
  }
  if (result.skipped.length > 0) {
    lines.push('Skipped:')
    for (const s of result.skipped) lines.push(`  - ${s.framework}: ${s.reason}`)
  }
  if (result.warnings.length > 0) {
    lines.push('Warnings:')
    for (const w of result.warnings) lines.push(`  - ${w}`)
  }
  return { exitCode: 0, output: lines.join('\n') }
}
