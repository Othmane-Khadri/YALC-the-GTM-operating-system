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
import { getRegistryReady } from '../../lib/providers/registry.js'
import type {
  FrameworkDefinition,
  InstalledFrameworkConfig,
  FrameworkOutputDestination,
} from '../../lib/frameworks/types.js'

const AGENTS_DIR = join(homedir(), '.gtm-os', 'agents')

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
  return cur ?? value
}

function ensureAgentsDir() {
  if (!existsSync(AGENTS_DIR)) mkdirSync(AGENTS_DIR, { recursive: true })
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

  // Auto-confirm flow: prefer dashboard. Notion stays opt-in to avoid
  // surprising the user with an unfinished Notion writer (0.7.0 stub).
  if (opts.autoConfirm) {
    return { destination: 'dashboard' }
  }

  const choices: Array<{ name: string; value: 'notion' | 'dashboard' }> = []
  if (notionDestinationAvailable()) {
    choices.push({ name: 'Notion (NOTION_API_KEY detected — output not yet implemented in 0.7.0)', value: 'notion' })
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

/** Write the agent yaml that the existing runner picks up via launchd. */
function writeAgentYaml(framework: FrameworkDefinition, cfg: InstalledFrameworkConfig): string {
  ensureAgentsDir()
  const agent = {
    id: framework.name,
    name: framework.display_name,
    description: framework.description,
    steps: framework.steps.map((s) => ({
      skillId: s.skill,
      input: { ...(s.input ?? {}), ...cfg.inputs },
      continueOnError: true,
    })),
    schedule: {
      type: 'daily' as const,
      hour: 8,
      minute: 0,
    },
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
  const yamlPath = writeAgentYaml(framework, cfg)
  runSeed(framework, inputs)

  console.log(`\nInstalled ${framework.name}.`)
  console.log(`  Agent yaml: ${yamlPath}`)
  if (dest.destination === 'dashboard') {
    console.log(`  Output:     http://localhost:3847/frameworks/${framework.name}`)
  } else {
    console.log(`  Output:     Notion (parent: ${dest.notionParent})`)
  }
  console.log(`  Schedule:   ${framework.schedule.cron}${framework.schedule.timezone ? ` (${framework.schedule.timezone})` : ''}`)
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
  const { runFramework, FrameworkRunError } = await import('../../lib/frameworks/runner.js')
  try {
    const { path, run } = await runFramework(name, { seed: !!opts.seed })
    console.log(`  Wrote: ${path}`)
    console.log(`  Rows:  ${run.rows.length}\n`)
  } catch (err) {
    if (err instanceof FrameworkRunError) {
      console.error(`  Step ${err.step} (${err.stepSkill}) failed: ${err.message}`)
      if (err.partialPath) console.error(`  Partial output: ${err.partialPath}`)
      process.exit(1)
    }
    throw err
  }
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
