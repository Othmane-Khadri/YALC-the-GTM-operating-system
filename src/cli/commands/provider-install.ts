/**
 * `yalc-gtm provider:install <capability>/<provider>` — fetch a community
 * manifest from the bundled providers/ directory (or a custom source), validate it
 * via `compileManifest`, write it under `~/.gtm-os/adapters/`, and
 * optionally amend the user's `~/.gtm-os/config.yaml` so the new
 * provider takes priority.
 *
 * Behaviour notes:
 *   - The handler never throws; every failure is converted into a
 *     non-zero `exitCode` and a single human-readable `output` string so
 *     the CLI wrapper can stream output without leaking stack traces.
 *   - Live HTTP smoke is **not** run here — that's `adapters:smoke`'s job.
 *     We only validate the manifest's shape so the user can't end up with
 *     a YAML on disk that the loader will reject at boot.
 *   - We refuse to clobber an existing manifest unless `--force` is set.
 *     Operators commonly hand-edit local manifests; a re-install must not
 *     silently destroy those edits.
 *   - The priority-list update is a separate, opt-in step. Defaults to
 *     interactive prompt when stdin is a TTY; non-interactive callers
 *     (tests, CI, scripted installs) pass `--no-priority-update` or
 *     `--yes` to skip the prompt.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { compileManifest } from '../../lib/providers/declarative/compiler.js'
import { ManifestValidationError } from '../../lib/providers/declarative/types.js'
import { defaultAdaptersDir } from '../../lib/providers/declarative/loader.js'

export interface ProviderInstallOptions {
  /** Override the user adapters dir (defaults to `~/.gtm-os/adapters`). */
  adaptersDir?: string
  /** Override the user config path (defaults to `~/.gtm-os/config.yaml`). */
  configPath?: string
  /**
   * Override the source URL the manifest is fetched from. When set, we use
   * this exact URL — no `<capability>/<provider>.yaml` suffix appended.
   */
  sourceUrl?: string
  /** Override the fetch implementation (used by tests). */
  fetchImpl?: typeof fetch
  /** Overwrite existing manifest. */
  force?: boolean
  /** Skip every interactive prompt. */
  noPrompt?: boolean
  /** Skip the priority-list update entirely. */
  noPriorityUpdate?: boolean
  /**
   * Auto-answer "yes" to the priority-update prompt. Implies !noPriorityUpdate.
   * Used by `--yes` and tests.
   */
  autoConfirmPriority?: boolean
}

export interface ProviderInstallResult {
  exitCode: number
  output: string
}

const DEFAULT_PROVIDERS_SOURCE =
  'https://raw.githubusercontent.com/Othmane-Khadri/YALC-the-GTM-operating-system/main/providers/manifests'

const ARG_PATTERN = /^([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/i

/**
 * Resolve the URL to fetch from. Priority:
 *   1. `--source <url>` (used verbatim — caller controls the path)
 *   2. `YALC_PROVIDERS_SOURCE` env var (treated as a base; we append
 *      `/<capability>/<provider>.yaml`)
 *   3. The hard-coded YALC main-repo raw URL pointing at providers/manifests/
 */
function resolveSourceUrl(
  capability: string,
  provider: string,
  opts: ProviderInstallOptions,
): string {
  if (opts.sourceUrl) return opts.sourceUrl
  const base = process.env.YALC_PROVIDERS_SOURCE ?? DEFAULT_PROVIDERS_SOURCE
  const trimmed = base.replace(/\/+$/, '')
  return `${trimmed}/${capability}/${provider}.yaml`
}

/**
 * Insert `provider` at the front of
 * `capabilities.<capability>.priority` in the YAML config at
 * `configPath`. Creates the file/section if missing. No-op when
 * `provider` is already at the front of the list.
 */
function updatePriorityList(
  configPath: string,
  capability: string,
  provider: string,
): { changed: boolean; before?: string[]; after?: string[] } {
  let raw = ''
  if (existsSync(configPath)) {
    raw = readFileSync(configPath, 'utf-8')
  }
  const parsed = (raw.trim().length > 0
    ? (yaml.load(raw) as Record<string, unknown> | null)
    : {}) ?? {}

  const root = parsed as Record<string, unknown>
  if (!root.capabilities || typeof root.capabilities !== 'object') {
    root.capabilities = {}
  }
  const caps = root.capabilities as Record<string, unknown>
  if (!caps[capability] || typeof caps[capability] !== 'object') {
    caps[capability] = {}
  }
  const capEntry = caps[capability] as Record<string, unknown>
  const before = Array.isArray(capEntry.priority)
    ? (capEntry.priority as string[]).slice()
    : []

  // No-op if already at front.
  if (before[0] === provider) {
    return { changed: false, before, after: before }
  }
  const after = [provider, ...before.filter((p) => p !== provider)]
  capEntry.priority = after

  // Ensure parent dir exists; some tests use a temp dir without
  // `.gtm-os/` pre-created.
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(
    configPath,
    yaml.dump(root, { lineWidth: 120, noRefs: true }),
    'utf-8',
  )
  return { changed: true, before, after }
}

/**
 * Best-effort interactive yes/no prompt. Returns `false` when stdin is
 * not a TTY (the user can't answer) so non-interactive runs default to
 * the safer "no" answer for priority updates.
 */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  process.stdout.write(`${question} [y/N] `)
  return new Promise<boolean>((resolveAns) => {
    const onData = (buf: Buffer) => {
      const line = buf.toString('utf-8').trim().toLowerCase()
      process.stdin.off('data', onData)
      process.stdin.pause()
      resolveAns(line === 'y' || line === 'yes')
    }
    process.stdin.resume()
    process.stdin.on('data', onData)
  })
}

export async function runProviderInstall(
  arg: string,
  opts: ProviderInstallOptions = {},
): Promise<ProviderInstallResult> {
  const lines: string[] = []

  // 1. Parse arg.
  const match = arg?.match(ARG_PATTERN)
  if (!match) {
    return {
      exitCode: 1,
      output:
        'Usage: yalc-gtm provider:install <capability>/<provider>\n' +
        'Example: yalc-gtm provider:install icp-company-search/apollo',
    }
  }
  const capability = match[1]
  const provider = match[2]

  // 2. Resolve URL + fetch.
  const url = resolveSourceUrl(capability, provider, opts)
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return {
      exitCode: 1,
      output: 'fetch is not available in this Node runtime (need Node ≥ 18).',
    }
  }

  // Node's built-in `fetch` does not support file:// URLs, but operators
  // hand us local paths all the time when iterating on a manifest before
  // it lands on the community repo. Do the read ourselves and short-
  // circuit fetch in that case. Tests can still inject a custom
  // `fetchImpl` and observe the URL passes through unchanged.
  let yamlText: string
  if (opts.fetchImpl) {
    let res: Response
    try {
      res = await fetchImpl(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: 1, output: `Failed to fetch ${url}: ${msg}` }
    }
    if (!res.ok) {
      return {
        exitCode: 1,
        output: `Failed to fetch ${url}: HTTP ${res.status} ${res.statusText || 'not found'}`,
      }
    }
    yamlText = await res.text()
  } else if (url.startsWith('file://')) {
    try {
      yamlText = readFileSync(fileURLToPath(url), 'utf-8')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: 1, output: `Failed to read ${url}: ${msg}` }
    }
  } else {
    let res: Response
    try {
      res = await fetchImpl(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { exitCode: 1, output: `Failed to fetch ${url}: ${msg}` }
    }
    if (!res.ok) {
      return {
        exitCode: 1,
        output: `Failed to fetch ${url}: HTTP ${res.status} ${res.statusText || 'not found'}`,
      }
    }
    yamlText = await res.text()
  }

  // 3. Validate via compileManifest. We don't run smoke — that's a
  // separate, explicit operator step.
  let envVars: string[] = []
  let manifestCapability = ''
  let manifestProvider = ''
  try {
    const compiled = compileManifest(yamlText, url)
    envVars = compiled.envVars
    manifestCapability = compiled.capabilityId
    manifestProvider = compiled.providerId
  } catch (err) {
    if (err instanceof ManifestValidationError) {
      const issues = err.issues.map((i) => `  - ${i}`).join('\n')
      return {
        exitCode: 1,
        output: `Manifest validation failed for ${url}:\n${issues}`,
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, output: `Failed to compile manifest: ${msg}` }
  }

  // 4. Sanity check: the manifest's declared (capability, provider)
  //    must match the install argument. Otherwise the file would land
  //    under a name that doesn't match its content — a foot-gun the
  //    loader would later report as a confusing mismatch.
  if (manifestCapability !== capability || manifestProvider !== provider) {
    return {
      exitCode: 1,
      output:
        `Manifest mismatch: requested ${capability}/${provider} but ` +
        `manifest declares ${manifestCapability}/${manifestProvider}.`,
    }
  }

  // 5. Resolve target path + write.
  const adaptersDir =
    opts.adaptersDir ??
    join(process.env.HOME ?? homedir(), '.gtm-os', 'adapters')
  // Mirror `defaultAdaptersDir()`'s shape so `adapters:list` can find it
  // without further hints.
  void defaultAdaptersDir

  const fileName = `${capability}-${provider}.yaml`
  const target = join(adaptersDir, fileName)
  if (existsSync(target) && !opts.force) {
    return {
      exitCode: 1,
      output:
        `Refusing to overwrite ${target} — file already exists. ` +
        `Re-run with --force to replace it.`,
    }
  }
  try {
    mkdirSync(adaptersDir, { recursive: true })
    writeFileSync(target, yamlText, 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { exitCode: 1, output: `Failed to write ${target}: ${msg}` }
  }

  lines.push(`Installed ${capability}/${provider}`)
  lines.push(`  manifest: ${target}`)
  lines.push(`  capability: ${capability}`)
  lines.push(`  provider: ${provider}`)
  if (envVars.length > 0) {
    lines.push(`  env vars required: ${envVars.join(', ')}`)
    const missing = envVars.filter((v) => !process.env[v])
    if (missing.length > 0) {
      lines.push('')
      lines.push(
        `Missing env: ${missing.join(', ')}. Add them to ~/.gtm-os/.env before invoking the adapter.`,
      )
    }
  } else {
    lines.push('  env vars required: (none)')
  }

  // 6. Priority-list update.
  const configPath =
    opts.configPath ??
    join(process.env.HOME ?? homedir(), '.gtm-os', 'config.yaml')

  if (!opts.noPriorityUpdate) {
    let proceed = false
    if (opts.autoConfirmPriority) {
      proceed = true
    } else if (!opts.noPrompt) {
      proceed = await confirm(
        `Add ${provider} to the front of capabilities.${capability}.priority in ${configPath}?`,
      )
    }
    if (proceed) {
      try {
        const upd = updatePriorityList(configPath, capability, provider)
        if (upd.changed) {
          lines.push('')
          lines.push(`Priority updated in ${configPath}:`)
          lines.push(`  before: [${(upd.before ?? []).join(', ')}]`)
          lines.push(`  after:  [${(upd.after ?? []).join(', ')}]`)
        } else {
          lines.push('')
          lines.push(`Priority already had ${provider} at the front — no change.`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lines.push('')
        lines.push(`Warning: failed to update priority list: ${msg}`)
      }
    } else if (!opts.noPrompt) {
      lines.push('')
      lines.push(
        `To prefer ${provider} for ${capability}, add it to capabilities.${capability}.priority in ${configPath}.`,
      )
    }
  }

  lines.push('')
  lines.push(
    `Run \`yalc-gtm adapters:list\` to confirm the new entry, or ` +
      `\`yalc-gtm adapters:smoke ${target}\` to verify against the live vendor.`,
  )

  return { exitCode: 0, output: lines.join('\n') }
}
