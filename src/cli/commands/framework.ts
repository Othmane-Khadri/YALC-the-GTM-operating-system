/**
 * `framework:*` CLI commands.
 *
 * Wired into the main `Commander` program in `src/cli/index.ts`. The
 * commands here mostly orchestrate `src/lib/frameworks/*` modules — the
 * actual schema, recommendation, and run logic lives there.
 *
 * No interactive prompts in `--auto-confirm` mode; everything else uses
 * the same `@inquirer/prompts` style as `agent:create`.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import yaml from 'js-yaml'
import { input, confirm, select } from '@inquirer/prompts'
import {
  loadAllFrameworks,
  findFramework,
} from '../../lib/frameworks/loader.js'
import {
  recommendFrameworks,
  gatherEnvironment,
  loadCompanyContext,
} from '../../lib/frameworks/recommend.js'
import {
  saveInstalledConfig,
  loadInstalledConfig,
  listInstalledFrameworks,
  removeInstalledConfig,
  setFrameworkDisabled,
  agentYamlPath,
  latestRun,
} from '../../lib/frameworks/registry.js'
import {
  writeRun,
  type DashboardRun,
} from '../../lib/frameworks/output/dashboard-adapter.js'
import {
  notionDestinationAvailable,
  validateNotionTarget,
  NotionAdapterUnavailableError,
} from '../../lib/frameworks/output/notion-adapter.js'
import { cronToAgentSchedule } from '../../lib/frameworks/cron-conversion.js'
import { getRegistryReady } from '../../lib/providers/registry.js'
import type {
  FrameworkDefinition,
  FrameworkStep,
  InstalledFrameworkConfig,
  FrameworkOutputDestination,
} from '../../lib/frameworks/types.js'
import { isGateStep } from '../../lib/frameworks/types.js'

/**
 * Resolve the agents/ directory at call time so HOME pivots in tests are
 * honoured. (Prior to 0.9.E this was a top-level constant frozen at import
 * time, which broke install tests that pivot HOME mid-suite.)
 */
function agentsDir(): string {
  return join(homedir(), '.gtm-os', 'agents')
}

/**
 * Hardcoded fallback values for `$context.icp.*` paths that may legitimately
 * resolve to an empty array on a freshly captured context (e.g. when the
 * synthesizer ran without an LLM key). The runtime falls back to these so
 * frameworks always have SOMETHING to run on, while emitting a WARN that
 * tells the user to fill the field manually.
 */
const CONTEXT_PATH_FALLBACKS: Record<string, string> = {
  'icp.subreddits': 'SaaS,startups,Entrepreneur',
  'icp.target_communities': 'SaaS,startups',
}

/** Resolve a `$context.path.like.this` reference against the loaded context. */
function resolveDefault(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('$context.')) return value
  const path = value.slice('$context.'.length)
  const ctx = loadCompanyContext()
  if (!ctx) return value
  const parts = path.split('.')
  let cur: unknown = ctx
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return value
    cur = (cur as Record<string, unknown>)[p]
  }
  // If the resolved value is an empty array AND we have a hardcoded fallback,
  // warn the user and substitute the legacy default so install + run never break.
  if (Array.isArray(cur) && cur.length === 0 && CONTEXT_PATH_FALLBACKS[path]) {
    // eslint-disable-next-line no-console
    console.warn(
      `[framework] ICP ${path} not captured; falling back to generic defaults. ` +
      `Edit ~/.gtm-os/company_context.yaml or re-run \`yalc-gtm start --regenerate icp\` to populate.`,
    )
    return CONTEXT_PATH_FALLBACKS[path]
  }
  return cur ?? value
}

function ensureAgentsDir() {
  const dir = agentsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/** Render a single recommendation row for the printed list. */
function fmtRec(name: string, displayName: string, description: string, dest: string): string {
  return `  ${name.padEnd(34)} → ${dest.padEnd(10)} ${displayName}\n     ${description}`
}

// ─── framework:list ────────────────────────────────────────────────────────

export async function runFrameworkList(): Promise<void> {
  const all = loadAllFrameworks()
  const installed = new Set(listInstalledFrameworks())

  if (all.length === 0) {
    console.log('No frameworks found.')
    return
  }
  console.log(`\nFrameworks (${all.length} bundled, ${installed.size} installed):\n`)
  for (const f of all) {
    const status = installed.has(f.name) ? 'INSTALLED' : 'available'
    console.log(`  ${f.name.padEnd(34)} ${status.padEnd(10)} ${f.display_name}`)
    console.log(`     ${f.description}`)
  }
  console.log()
}

// ─── framework:recommend ───────────────────────────────────────────────────

async function gatherProviderIds(): Promise<string[]> {
  try {
    const reg = await getRegistryReady()
    return reg.getAll().filter((p) => p.status === 'active').map((p) => p.id)
  } catch {
    return []
  }
}

export async function runFrameworkRecommend(): Promise<void> {
  const providers = await gatherProviderIds()
  const env = gatherEnvironment({ providers })
  const { recommended, eligibleOnly, ineligible } = recommendFrameworks(env)

  if (recommended.length === 0 && eligibleOnly.length === 0) {
    console.log('\nNo frameworks recommended yet — your setup is missing required providers / context.')
    if (ineligible.length > 0) {
      console.log('\nWhy:')
      for (const i of ineligible) {
        console.log(`  - ${i.framework}: ${i.detail}`)
      }
    }
    console.log('\nRun `yalc-gtm framework:list` to see all bundled frameworks.\n')
    return
  }

  if (recommended.length > 0) {
    console.log(`\nRecommended for your setup (${recommended.length}):\n`)
    for (const r of recommended) {
      console.log(
        fmtRec(
          r.framework.name,
          r.framework.display_name,
          r.framework.description,
          r.preferredDestination,
        ),
      )
    }
  }

  if (eligibleOnly.length > 0) {
    console.log(`\nEligible but not recommended right now (${eligibleOnly.length}):`)
    for (const r of eligibleOnly) {
      console.log(`  ${r.framework.name.padEnd(34)} ${r.framework.display_name}`)
    }
  }

  console.log('\nInstall any of these with: yalc-gtm framework:install <name>\n')
}

// ─── framework:install ─────────────────────────────────────────────────────

interface InstallOpts {
  autoConfirm?: boolean
  destination?: 'notion' | 'dashboard'
  notionParent?: string
}

async function pickDestination(
  framework: FrameworkDefinition,
  opts: InstallOpts,
): Promise<{ destination: FrameworkOutputDestination; notionParent?: string }> {
  if (opts.destination) {
    if (opts.destination === 'notion' && !notionDestinationAvailable()) {
      throw new Error('NOTION_API_KEY not set — set it in ~/.gtm-os/.env or pick --destination dashboard')
    }
    if (opts.destination === 'notion') {
      const parent = opts.notionParent ?? ''
      validateNotionTarget({ parentPageId: parent })
      return { destination: 'notion', notionParent: parent }
    }
    return { destination: 'dashboard' }
  }

  // Auto-confirm flow: prefer dashboard so the install completes without
  // requiring a Notion parent page id at the prompt.
  if (opts.autoConfirm) {
    return { destination: 'dashboard' }
  }

  const choices: Array<{ name: string; value: 'notion' | 'dashboard' }> = []
  if (notionDestinationAvailable()) {
    choices.push({ name: 'Notion (NOTION_API_KEY detected)', value: 'notion' })
  }
  choices.push({ name: 'Local dashboard (recommended)', value: 'dashboard' })

  const dest = await select({
    message: 'Output destination?',
    choices,
    default: 'dashboard',
  })

  if (dest === 'notion') {
    const parent = await input({
      message: 'Notion parent page ID (where output pages will be created):',
      validate: (v) => (v && v.length >= 8 ? true : 'Required'),
    })
    try {
      validateNotionTarget({ parentPageId: parent })
    } catch (err) {
      if (err instanceof NotionAdapterUnavailableError) {
        console.error(`  ${err.message}`)
        process.exit(1)
      }
      throw err
    }
    void framework
    return { destination: 'notion', notionParent: parent }
  }
  return { destination: 'dashboard' }
}

async function collectInputs(
  framework: FrameworkDefinition,
  opts: InstallOpts,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {}
  for (const slot of framework.inputs) {
    const def = resolveDefault(slot.default ?? null)
    if (opts.autoConfirm) {
      out[slot.name] = def
      continue
    }
    const printed = Array.isArray(def) ? def.join(',') : def == null ? '' : String(def)
    const answer = await input({
      message: `${slot.name} — ${slot.description}`,
      default: printed,
    })
    out[slot.name] = answer
  }
  return out
}

/**
 * Write the agent yaml that the existing runner picks up via launchd.
 *
 * On-demand frameworks (`mode: on-demand`) are intentionally NOT written —
 * launchd would have nothing to schedule, and `framework:run <name>` is the
 * only sanctioned trigger. The caller checks `mode` and skips this when so.
 *
 * Gate steps are dropped from the launchd-readable step list — they're
 * runtime-only pauses and the agent runner doesn't know how to wait for
 * a human. The framework runner re-reads the original yaml and handles
 * gates there.
 */
function writeAgentYaml(framework: FrameworkDefinition, cfg: InstalledFrameworkConfig): string {
  ensureAgentsDir()
  if (!framework.schedule.cron) {
    throw new Error(`Framework "${framework.name}" has no schedule.cron — cannot install`)
  }
  const schedule = cronToAgentSchedule(framework.schedule.cron)
  const skillSteps = framework.steps.filter((s): s is FrameworkStep => !isGateStep(s))
  const agent = {
    id: framework.name,
    name: framework.display_name,
    description: framework.description,
    steps: skillSteps.map((s) => ({
      skillId: s.skill,
      input: { ...(s.input ?? {}), ...cfg.inputs },
      continueOnError: true,
    })),
    schedule,
    maxRetries: 2,
    timeoutMs: 600000,
  }
  const path = agentYamlPath(framework.name)
  writeFileSync(path, yaml.dump(agent), 'utf-8')
  return path
}

/** Stub seed run — produces an empty DashboardRun so the route always 200s. */
function runSeed(framework: FrameworkDefinition, inputs: Record<string, unknown>): void {
  const run: DashboardRun = {
    title: `${framework.display_name} — initial state`,
    summary:
      framework.seed_run?.description ??
      'Installed. The framework will populate this view on its next scheduled run.',
    rows: [],
    ranAt: new Date().toISOString(),
    meta: { inputs, seed: true },
  }
  writeRun(framework.name, run)
}

export async function runFrameworkInstall(name: string, opts: InstallOpts): Promise<void> {
  const framework = findFramework(name)
  if (!framework) {
    const all = loadAllFrameworks()
      .map((f) => f.name)
      .join(', ')
    console.error(`Unknown framework: ${name}. Available: ${all}`)
    process.exit(1)
  }

  if (loadInstalledConfig(name)) {
    console.error(`Framework "${name}" already installed. Remove it first: yalc-gtm framework:remove ${name}`)
    process.exit(1)
  }

  console.log(`\n${framework.display_name}`)
  console.log(`${framework.description}\n`)

  if (!opts.autoConfirm) {
    const proceed = await confirm({ message: 'Install this framework?', default: true })
    if (!proceed) {
      console.log('Cancelled.')
      return
    }
  }

  const inputs = await collectInputs(framework, opts)
  const dest = await pickDestination(framework, opts)

  const cfg: InstalledFrameworkConfig = {
    name: framework.name,
    display_name: framework.display_name,
    description: framework.description,
    installed_at: new Date().toISOString(),
    schedule: framework.schedule,
    output: {
      destination: dest.destination,
      notion_parent_page: dest.notionParent,
      dashboard_route: dest.destination === 'dashboard' ? `/frameworks/${framework.name}` : undefined,
    },
    inputs,
  }
  saveInstalledConfig(cfg)
  // On-demand frameworks skip the launchd agent yaml — they only run via
  // `framework:run`. Scheduled frameworks (the default) keep the legacy
  // 0.7.0 / 0.8.0 install plumbing.
  const isOnDemand = framework.mode === 'on-demand'
  const yamlPath = isOnDemand ? null : writeAgentYaml(framework, cfg)
  runSeed(framework, inputs)

  console.log(`\nInstalled ${framework.name}.`)
  if (yamlPath) console.log(`  Agent yaml: ${yamlPath}`)
  if (dest.destination === 'dashboard') {
    console.log(`  Output:     http://localhost:3847/frameworks/${framework.name}`)
  } else {
    console.log(`  Output:     Notion (parent: ${dest.notionParent})`)
  }
  if (isOnDemand) {
    console.log(`  Schedule:   on-demand (run with: yalc-gtm framework:run ${framework.name})`)
  } else {
    console.log(`  Schedule:   ${framework.schedule.cron}${framework.schedule.timezone ? ` (${framework.schedule.timezone})` : ''}`)
  }
  console.log(`  Logs:       yalc-gtm framework:logs ${framework.name}`)
  console.log()
}

// ─── framework:run ─────────────────────────────────────────────────────────

interface RunOpts {
  seed?: boolean
}

export async function runFrameworkRun(name: string, opts: RunOpts = {}): Promise<void> {
  const framework = findFramework(name)
  if (!framework) {
    console.error(`Unknown framework: ${name}`)
    process.exit(1)
  }
  const cfg = loadInstalledConfig(name)
  if (!cfg) {
    console.error(`Framework "${name}" is not installed. Install it first: yalc-gtm framework:install ${name}`)
    process.exit(1)
  }
  void framework
  console.log(`\nRunning ${name} now…`)
  const { runFramework, FrameworkRunError, FrameworkGatePauseError, EXIT_CODE_AWAITING_GATE } =
    await import('../../lib/frameworks/runner.js')
  try {
    const { path, run } = await runFramework(name, { seed: !!opts.seed })
    console.log(`  Wrote: ${path}`)
    console.log(`  Rows:  ${run.rows.length}\n`)
  } catch (err) {
    if (err instanceof FrameworkGatePauseError) {
      console.log(`  Run paused at gate \`${err.gateId}\`. View: http://localhost:3847/today`)
      console.log(`  Awaiting gate file: ${err.awaitingGatePath}`)
      process.exit(EXIT_CODE_AWAITING_GATE)
    }
    if (err instanceof FrameworkRunError) {
      console.error(`  Step ${err.step} (${err.stepSkill}) failed: ${err.message}`)
      if (err.partialPath) console.error(`  Partial output: ${err.partialPath}`)
      process.exit(1)
    }
    throw err
  }
}

// ─── framework:resume ──────────────────────────────────────────────────────

interface ResumeOpts {
  fromGate: string
}

/**
 * Resume a paused framework run.
 *
 * Reads the gate-approved.json (or gate-rejected.json) sibling of the
 * awaiting-gate sentinel, then either:
 *   - approved → continues execution from `step_index + 1` with payload
 *     edits already baked into the prior step outputs.
 *   - rejected → starts a fresh run from step 0 with `rejection_reason`
 *     threaded into the runner's variable map.
 *
 * Used directly by the CLI and (in-process) by `/api/gates/<id>/approve`.
 */
export async function runFrameworkResume(
  name: string,
  opts: ResumeOpts,
): Promise<{ path: string; rows: number; mode: 'approved' | 'rejected' }> {
  const cfg = loadInstalledConfig(name)
  if (!cfg) {
    throw new Error(`Framework "${name}" is not installed`)
  }
  const runId = opts.fromGate
  const { readGateState } = await import('../../lib/frameworks/gates.js')
  const state = readGateState(name, runId)
  if (state.kind === 'missing') {
    throw new Error(
      `No gate sentinel for run ${runId} on framework ${name}. ` +
      `Approve or reject the gate first via /api/gates/${runId}/{approve,reject}.`,
    )
  }
  if (state.kind === 'awaiting') {
    throw new Error(
      `Gate for run ${runId} on framework ${name} is still awaiting human input. ` +
      `Approve or reject before resuming.`,
    )
  }
  const { runFramework } = await import('../../lib/frameworks/runner.js')
  const { clearAwaitingSentinel } = await import('../../lib/frameworks/gates.js')
  if (state.kind === 'approved') {
    const r = state.record
    const { path, run } = await runFramework(name, {
      resume: {
        runId: r.run_id,
        startAtStep: r.step_index + 1,
        priorStepOutputs: r.prior_step_outputs,
        ...(r.payload_step_index !== null && r.payload_step_index !== undefined
          ? { payloadOverride: { stepIndex: r.payload_step_index, value: r.payload } }
          : {}),
      },
    })
    clearAwaitingSentinel(name, runId)
    return { path, rows: run.rows.length, mode: 'approved' }
  }
  // rejected → restart from step 0 with rejection_reason in vars.
  const r = state.record
  const { path, run } = await runFramework(name, {
    resume: {
      runId: r.run_id,
      startAtStep: 0,
      priorStepOutputs: [],
      rejectionReason: r.reason,
    },
  })
  clearAwaitingSentinel(name, runId)
  return { path, rows: run.rows.length, mode: 'rejected' }
}

// ─── framework:status ──────────────────────────────────────────────────────

export async function runFrameworkStatus(name: string): Promise<void> {
  const framework = findFramework(name)
  const cfg = loadInstalledConfig(name)
  if (!framework || !cfg) {
    console.error(`Framework "${name}" not installed.`)
    process.exit(1)
  }
  const last = latestRun(name)
  console.log(`\n${cfg.display_name} (${cfg.name})`)
  console.log(`  Status:        ${cfg.disabled ? 'disabled' : 'active'}`)
  console.log(`  Installed at:  ${cfg.installed_at}`)
  console.log(`  Schedule:      ${cfg.schedule.cron ?? '?'}`)
  console.log(`  Destination:   ${cfg.output.destination}`)
  if (cfg.output.dashboard_route) {
    console.log(`  Dashboard:     http://localhost:3847${cfg.output.dashboard_route}`)
  }
  if (cfg.output.notion_parent_page) {
    console.log(`  Notion parent: ${cfg.output.notion_parent_page}`)
  }
  console.log(`  Last run:      ${last ? (last.data as { ranAt?: string }).ranAt ?? '?' : 'never'}`)
  console.log()
}

// ─── framework:logs ────────────────────────────────────────────────────────

export async function runFrameworkLogs(name: string): Promise<void> {
  const cfg = loadInstalledConfig(name)
  if (!cfg) {
    console.error(`Framework "${name}" not installed.`)
    process.exit(1)
  }
  const last = latestRun(name)
  if (!last) {
    console.log(`No runs yet for ${name}.`)
    return
  }
  console.log(`\nLatest run for ${name}:`)
  console.log(`  Path: ${last.path}\n`)
  const data = last.data as DashboardRun
  console.log(`  Title:   ${data.title}`)
  console.log(`  Ran at:  ${data.ranAt}`)
  if (data.summary) console.log(`  Summary: ${data.summary}`)
  console.log(`  Rows:    ${Array.isArray(data.rows) ? data.rows.length : 0}`)
  console.log()
}

// ─── framework:disable ─────────────────────────────────────────────────────

export async function runFrameworkDisable(name: string): Promise<void> {
  const ok = setFrameworkDisabled(name, true)
  if (!ok) {
    console.error(`Framework "${name}" not installed.`)
    process.exit(1)
  }
  console.log(`Disabled ${name}. Config preserved. Re-enable with: yalc-gtm framework:install (will detect existing config) — or edit ~/.gtm-os/frameworks/installed/${name}.json directly.`)
}

// ─── framework:remove ──────────────────────────────────────────────────────

export async function runFrameworkRemove(name: string): Promise<void> {
  const cfg = loadInstalledConfig(name)
  if (!cfg) {
    console.error(`Framework "${name}" not installed.`)
    process.exit(1)
  }
  removeInstalledConfig(name)
  console.log(`Removed ${name} (config + agent yaml + runs).`)
}
