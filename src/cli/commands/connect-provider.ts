/**
 * `yalc-gtm connect-provider <name>` — legacy alias for `keys:connect`.
 *
 * 0.8.E shipped this command as the primary surface for adding a provider.
 * 0.9.D inverts the headline UX: the agnostic flow ("tell us about your
 * provider") is now the default — the bundled knowledge base ships entries
 * for ~10 providers as *suggestions*, not as the menu. The browser-based
 * /keys/connect SPA route is the recommended flow because keys never cross
 * the chat transcript.
 *
 * This file preserves the 0.8.E behavior so existing scripts keep working:
 *
 *   1. Resolve the provider in the knowledge base (closest-match suggest on miss).
 *   2. Print install steps (template-substituted) and required env vars.
 *   3. Wait for the user to confirm "keys done" — TTY: stdin sentinel; non-TTY:
 *      filesystem sentinel under `~/.gtm-os/_handoffs/keys/<id>.ready`.
 *   4. Reload `.env`, run the registered provider's `selfHealthCheck()`.
 *   5. Copy the bundled MCP template into `~/.gtm-os/mcp/<name>.json`.
 *   6. Run the `test_query` and print a truncated result.
 *   7. Append `<id>` to `capabilities.<cap>.priority` in `~/.gtm-os/config.yaml`.
 *
 * Custom-provider fallthrough (when the name is not in the knowledge base):
 *   - In TTY mode prompt for kind / command / env vars and write a yaml to
 *     `configs/providers/_user/<name>.yaml`.
 *   - In non-TTY mode emit a JSON instruction blob the orchestrator can act on.
 *
 * For new flows, prefer `yalc-gtm keys:connect [<provider>] --open` — it
 * opens the SPA form, polls the same sentinel, and never echoes keys to chat.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import yaml from 'js-yaml'
import { config as loadEnv } from 'dotenv'

import {
  closestProviderIds,
  loadProviderKnowledge,
  templateInstallStep,
  type ProviderKnowledge,
} from '../../lib/providers/knowledge-base.js'
import { PKG_ROOT } from '../../lib/paths.js'
import { getRegistryReady } from '../../lib/providers/registry.js'

const DEFAULT_HANDOFF_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
const POLL_INTERVAL_MS = 1000

export interface ConnectProviderOptions {
  /** Override stdin TTY detection (used by tests). */
  forceNonTty?: boolean
  /** Override the per-poll timeout (tests). */
  handoffTimeoutMs?: number
  /** Override the home directory for sandbox testing. */
  homeOverride?: string
  /** When true, skip the actual handoff wait — used by tests. */
  skipHandoffWait?: boolean
  /** When provided, use this as the answer in TTY mode instead of stdin. */
  ttyAnswerOverride?: string
}

export interface ConnectProviderResult {
  providerId: string
  installStatus: 'pending_keys' | 'configured' | 'failed' | 'custom_provider_created'
  /** Exit code the CLI should return (0 happy, 1 failure). */
  exitCode: number
  /** Human-readable next action printed at the end. */
  nextAction: string
  /** Issues surfaced during the walk-through. */
  issues: string[]
}

function resolveHome(opts: ConnectProviderOptions): string {
  return opts.homeOverride ?? homedir()
}

function gtmDir(opts: ConnectProviderOptions): string {
  return join(resolveHome(opts), '.gtm-os')
}

function envFilePath(opts: ConnectProviderOptions): string {
  return join(gtmDir(opts), '.env')
}

function configFilePath(opts: ConnectProviderOptions): string {
  return join(gtmDir(opts), 'config.yaml')
}

function mcpDir(opts: ConnectProviderOptions): string {
  return join(gtmDir(opts), 'mcp')
}

function handoffDir(opts: ConnectProviderOptions): string {
  return join(gtmDir(opts), '_handoffs', 'keys')
}

function userProvidersDir(): string {
  // Custom-provider yamls go in the bundled tree under `_user/` (per the
  // task spec) so the bundled loader picks them up alongside everything
  // else. The directory is created lazily when the user opts in.
  return join(PKG_ROOT, 'configs', 'providers', '_user')
}

function isInteractive(opts: ConnectProviderOptions): boolean {
  if (opts.forceNonTty) return false
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY)
}

/** Mask a value for display — never print full secrets to chat. */
export function maskSecret(value: string | undefined): string {
  if (!value) return '(not set)'
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}…${value.slice(-2)}`
}

function loadKnowledgeMap(opts: ConnectProviderOptions): Map<string, ProviderKnowledge> {
  return loadProviderKnowledge({
    bundledDir: join(PKG_ROOT, 'configs', 'providers'),
    userDir: join(gtmDir(opts), 'providers'),
  })
}

/**
 * Append an entry to a `capabilities.<id>.priority` list in `config.yaml`.
 * Preserves the existing order; idempotent (no duplicates). Returns the
 * resulting priority array (after merge).
 */
export function appendCapabilityPriority(
  configPath: string,
  capabilityId: string,
  providerId: string,
): string[] {
  let cfg: Record<string, unknown> = {}
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, 'utf-8')
      const loaded = yaml.load(raw)
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        cfg = loaded as Record<string, unknown>
      }
    } catch {
      cfg = {}
    }
  }
  const caps = (cfg.capabilities && typeof cfg.capabilities === 'object'
    ? (cfg.capabilities as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const slot = (caps[capabilityId] && typeof caps[capabilityId] === 'object'
    ? (caps[capabilityId] as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const existing = Array.isArray(slot.priority) ? (slot.priority as unknown[]).filter((s): s is string => typeof s === 'string') : []
  const merged = [...existing]
  if (!merged.includes(providerId)) merged.push(providerId)
  slot.priority = merged
  caps[capabilityId] = slot
  cfg.capabilities = caps
  const dir = join(configPath, '..')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, yaml.dump(cfg, { lineWidth: 100 }), 'utf-8')
  return merged
}

/**
 * Best-effort env-var presence check. Returns the set of missing required
 * env var names. Does NOT validate values past the non-empty check; deeper
 * validation happens via the provider's `selfHealthCheck()` when available.
 */
export function checkEnvVarsPresent(knowledge: ProviderKnowledge): string[] {
  const missing: string[] = []
  for (const ev of knowledge.env_vars) {
    if (ev.required === false) continue
    const v = process.env[ev.name]
    if (!v || v.trim() === '') missing.push(ev.name)
  }
  return missing
}

/** Reload `~/.gtm-os/.env` so post-edit values take effect in-process. */
function reloadEnv(opts: ConnectProviderOptions): void {
  const path = envFilePath(opts)
  if (existsSync(path)) {
    loadEnv({ path, quiet: true, override: true })
  }
}

async function waitForHandoffSentinel(
  opts: ConnectProviderOptions,
  providerId: string,
): Promise<{ ready: boolean; reason?: string }> {
  const dir = handoffDir(opts)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const sentinel = join(dir, `${providerId}.ready`)
  if (opts.skipHandoffWait) {
    return existsSync(sentinel) ? { ready: true } : { ready: false, reason: 'skipped' }
  }
  const timeout = opts.handoffTimeoutMs ?? DEFAULT_HANDOFF_TIMEOUT_MS
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (existsSync(sentinel)) return { ready: true }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  return { ready: false, reason: 'timeout' }
}

async function readKeysDoneFromTTY(): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    while (true) {
      const answer: string = await new Promise((resolve) => {
        rl.question(
          '  When you are done editing the .env file, type "keys done" and press Enter (Ctrl+C to abort): ',
          (line) => resolve(line),
        )
      })
      if (answer.trim().toLowerCase() === 'keys done') return true
      console.log('  (waiting — type "keys done" to continue)')
    }
  } finally {
    rl.close()
  }
}

/** Run the knowledge-base `test_query` via the capability registry. */
async function runTestQuery(
  knowledge: ProviderKnowledge,
): Promise<{ ok: boolean; detail: string; truncated?: string }> {
  if (!knowledge.test_query) {
    return { ok: true, detail: '(no test_query declared)' }
  }
  try {
    const { getCapabilityRegistryReady } = await import('../../lib/providers/capabilities.js')
    const capRegistry = await getCapabilityRegistryReady()
    const adapter = await capRegistry.resolve(knowledge.test_query.capability)
    const providerRegistry = await getRegistryReady()
    const executor = (() => {
      try {
        return providerRegistry.resolve({ stepType: 'custom', provider: adapter.providerId })
      } catch {
        return null
      }
    })()
    const result = await adapter.execute(knowledge.test_query.input ?? {}, {
      executor,
      registry: providerRegistry,
    })
    const json = JSON.stringify(result)
    const truncated = json.length > 240 ? `${json.slice(0, 237)}...` : json
    return { ok: true, detail: 'ok', truncated }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, detail: message }
  }
}

interface CustomProviderInput {
  id: string
  kind: 'rest' | 'mcp'
  command?: string
  args?: string[]
  envVars: Array<{ name: string; example?: string }>
}

/** Persist a custom provider yaml to `configs/providers/_user/<id>.yaml`. */
export function writeCustomProviderYaml(input: CustomProviderInput): string {
  const dir = userProvidersDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const yamlObj: Record<string, unknown> = {
    id: input.id,
    display_name: input.id,
    integration_kind: input.kind,
    env_vars: input.envVars.map((ev) => ({
      name: ev.name,
      description: 'Custom-provider key — set in ~/.gtm-os/.env',
      example: ev.example ?? '',
      required: true,
    })),
    capabilities_supported: [],
    install_steps: [
      'Open ~/.gtm-os/.env and set the env vars listed above.',
      `Re-run: yalc-gtm connect-provider ${input.id}`,
    ],
    test_query: null,
  }
  if (input.kind === 'mcp' && input.command) {
    yamlObj._mcp_command = input.command
    if (input.args && input.args.length > 0) {
      yamlObj._mcp_args = input.args
    }
  }
  const target = join(dir, `${input.id}.yaml`)
  writeFileSync(target, yaml.dump(yamlObj, { lineWidth: 100 }), 'utf-8')
  return target
}

async function promptCustomProvider(
  providerName: string,
): Promise<CustomProviderInput | null> {
  const { input: promptInput, select, confirm } = await import('@inquirer/prompts')
  const wantCustom = await confirm({
    message: `Provider "${providerName}" is not in the knowledge base. Create a custom entry?`,
    default: true,
  })
  if (!wantCustom) return null
  const kind = (await select({
    message: 'Integration kind?',
    choices: [
      { name: 'REST', value: 'rest' as const },
      { name: 'MCP', value: 'mcp' as const },
    ],
  })) as 'rest' | 'mcp'
  let command: string | undefined
  let args: string[] | undefined
  if (kind === 'mcp') {
    command = await promptInput({ message: 'MCP command (e.g. npx):', validate: (v) => v.trim() !== '' || 'required' })
    const argsRaw = await promptInput({ message: 'MCP args (comma-separated):', default: '' })
    args = argsRaw.split(',').map((a) => a.trim()).filter((a) => a.length > 0)
  }
  const envVarsRaw = await promptInput({
    message: 'Env vars (k=v list, comma-separated; values are placeholders only):',
    default: '',
  })
  const envVars: Array<{ name: string; example?: string }> = []
  for (const piece of envVarsRaw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...rest] = piece.split('=')
    envVars.push({ name: name.trim(), example: rest.join('=').trim() || undefined })
  }
  return { id: providerName, kind, command, args, envVars }
}

/**
 * Top-level entry point. Returns a structured result so tests can assert
 * exit codes / status without parsing stdout.
 */
export async function runConnectProvider(
  providerName: string,
  opts: ConnectProviderOptions = {},
): Promise<ConnectProviderResult> {
  const issues: string[] = []
  console.log(`\n── connect-provider ${providerName} ──\n`)

  const knowledgeMap = loadKnowledgeMap(opts)
  let knowledge = knowledgeMap.get(providerName)

  if (!knowledge) {
    const candidates = Array.from(knowledgeMap.keys())
    const suggestions = closestProviderIds(providerName, candidates, 3)
    if (suggestions.length > 0) {
      console.log(`  No bundled knowledge for "${providerName}". Closest matches:`)
      for (const s of suggestions) console.log(`    - ${s}`)
      console.log('')
    } else {
      console.log(`  No bundled knowledge for "${providerName}".`)
    }

    if (!isInteractive(opts)) {
      console.log('  Non-interactive shell detected. Re-run with TTY to opt into a custom-provider entry,')
      console.log(`  or place a yaml at configs/providers/_user/${providerName}.yaml and re-run.`)
      return {
        providerId: providerName,
        installStatus: 'failed',
        exitCode: 1,
        nextAction: `Create configs/providers/_user/${providerName}.yaml or pick one of: ${suggestions.join(', ') || 'none'}`,
        issues: [`unknown provider: ${providerName}`],
      }
    }

    const custom = await promptCustomProvider(providerName)
    if (!custom) {
      return {
        providerId: providerName,
        installStatus: 'failed',
        exitCode: 1,
        nextAction: `Pick one of: ${suggestions.join(', ') || 'none'}`,
        issues: [`unknown provider: ${providerName}`],
      }
    }
    const written = writeCustomProviderYaml(custom)
    console.log(`\n  Wrote custom-provider yaml: ${written}`)
    console.log(`  Re-run: yalc-gtm connect-provider ${custom.id}`)
    return {
      providerId: custom.id,
      installStatus: 'custom_provider_created',
      exitCode: 0,
      nextAction: `yalc-gtm connect-provider ${custom.id}`,
      issues: [],
    }
  }

  // Print install steps with template substitution.
  console.log(`  ${knowledge.display_name} (${knowledge.integration_kind})`)
  if (knowledge.homepage) console.log(`  Homepage: ${knowledge.homepage}`)
  if (knowledge.key_acquisition_url) console.log(`  Get key: ${knowledge.key_acquisition_url}`)
  console.log('')
  console.log('  Install steps:')
  for (const step of knowledge.install_steps) {
    console.log(`    - ${templateInstallStep(step, knowledge)}`)
  }

  console.log('\n  Add these to ~/.gtm-os/.env (open in your editor — never paste secrets in chat):')
  for (const ev of knowledge.env_vars) {
    const masked = maskSecret(process.env[ev.name])
    console.log(`    ${ev.name}=${masked}    ${ev.description ?? ''}`)
  }

  // Wait for the user to confirm "keys done" — TTY or sentinel-file.
  const tty = isInteractive(opts)
  if (tty) {
    if (opts.ttyAnswerOverride !== undefined) {
      // tests can pass a sentinel string in lieu of stdin
      if (opts.ttyAnswerOverride.trim().toLowerCase() !== 'keys done') {
        return {
          providerId: knowledge.id,
          installStatus: 'failed',
          exitCode: 1,
          nextAction: 'Re-run after adding the env vars.',
          issues: ['user did not confirm "keys done"'],
        }
      }
    } else {
      await readKeysDoneFromTTY()
    }
  } else {
    const sentinel = join(handoffDir(opts), `${knowledge.id}.ready`)
    console.log(`\n  Non-interactive shell — touch this file to continue:`)
    console.log(`    ${sentinel}`)
    const wait = await waitForHandoffSentinel(opts, knowledge.id)
    if (!wait.ready) {
      issues.push(`handoff timed out waiting for ${sentinel}`)
      return {
        providerId: knowledge.id,
        installStatus: 'pending_keys',
        exitCode: 1,
        nextAction: `Touch ${sentinel} and re-run.`,
        issues,
      }
    }
  }

  // Re-read env, validate keys, run health check.
  reloadEnv(opts)
  const missing = checkEnvVarsPresent(knowledge)
  if (missing.length > 0) {
    issues.push(`missing env vars: ${missing.join(', ')}`)
    return {
      providerId: knowledge.id,
      installStatus: 'failed',
      exitCode: 1,
      nextAction: `Set ${missing.join(', ')} in ~/.gtm-os/.env and re-run.`,
      issues,
    }
  }

  // MCP — copy the bundled template into ~/.gtm-os/mcp/<name>.json.
  if (knowledge.integration_kind === 'mcp' && knowledge.mcp_template) {
    const tplPath = join(PKG_ROOT, 'configs', 'mcp', `${knowledge.mcp_template}.json`)
    if (existsSync(tplPath)) {
      const target = join(mcpDir(opts), `${knowledge.id}.json`)
      mkdirSync(mcpDir(opts), { recursive: true })
      copyFileSync(tplPath, target)
      console.log(`  Wrote MCP config: ${target}`)
    } else {
      issues.push(`MCP template not found at ${tplPath}`)
    }
  }

  // Run the test_query.
  const test = await runTestQuery(knowledge)
  if (!test.ok) {
    issues.push(`test_query failed: ${test.detail}`)
    return {
      providerId: knowledge.id,
      installStatus: 'failed',
      exitCode: 1,
      nextAction: 'Inspect the error above and verify your key is correct.',
      issues,
    }
  }
  console.log(`  test_query: ${test.detail}`)
  if (test.truncated) console.log(`    ${test.truncated}`)

  // Append <id> to capabilities.<cap>.priority for every supported capability.
  const cfgPath = configFilePath(opts)
  for (const cap of knowledge.capabilities_supported) {
    const merged = appendCapabilityPriority(cfgPath, cap.id, knowledge.id)
    console.log(`  capabilities.${cap.id}.priority = [${merged.join(', ')}]`)
  }

  console.log(`\n  Connected. Run \`yalc-gtm framework:recommend\` to see what new frameworks are now available.`)

  return {
    providerId: knowledge.id,
    installStatus: 'configured',
    exitCode: 0,
    nextAction: 'yalc-gtm framework:recommend',
    issues,
  }
}
