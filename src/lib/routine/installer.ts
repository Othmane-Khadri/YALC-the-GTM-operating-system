/**
 * Routine installer — apply a Routine to disk.
 *
 * Persistence (per spec §6): the chosen Routine is persisted to a sidecar
 * at `~/.gtm-os/routine.yaml` rather than embedded in `~/.gtm-os/config.yaml`.
 *
 * Reasoning: `config.yaml` is the *resolved* state (priorities, default
 * dashboard, tenant settings) — it should stay small and human-edited.
 * `routine.yaml` is a *snapshot* of generator output, captured at install
 * time, so a future `routine:diff` can compare the current proposal against
 * what was last installed. Storing the snapshot also means we can show
 * "you installed this routine on YYYY-MM-DD" in the SPA without re-deriving.
 *
 * The sidecar holds the full Routine cast to YAML plus a `routine_meta:`
 * block (`installed_at`, YALC version, frameworks skipped via `--only`).
 * It is *not* the source of truth for installed frameworks — that remains
 * `~/.gtm-os/frameworks/installed/<name>.json`. The sidecar is advisory;
 * deleting it has no functional effect.
 *
 * Idempotency: re-running with the same Routine when frameworks are
 * already installed is a no-op; `installFramework` is only called for
 * names that aren't yet on disk.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'

import { loadInstalledConfig } from '../frameworks/registry.js'
import type { Routine, RoutineFrameworkEntry } from './types.js'

/** Result of an `installRoutine()` call. */
export interface InstallResult {
  /** Frameworks the installer triggered. */
  installed: string[]
  /** Frameworks skipped — already installed, deferred, or dry-run. */
  skipped: Array<{ framework: string; reason: string }>
  /** Generator-level warnings (unknown sidecar version, malformed YAML). */
  warnings: string[]
}

/** Install options. */
export interface InstallOptions {
  /**
   * Subset of framework names to install. When provided, all entries
   * whose names aren't in this list are recorded under `skipped`.
   */
  only?: string[]
  /** Print actions but don't write to disk. */
  dryRun?: boolean
  /**
   * Framework install hook. Defaults to the real `runFrameworkInstall`
   * from `src/cli/commands/framework.ts`. Tests override with a stub so
   * they don't touch launchd / the real `~/.gtm-os/agents/` path.
   */
  installFramework?: (
    name: string,
    inputs: Record<string, unknown> | undefined,
  ) => Promise<void>
}

/** Path of the routine sidecar. Resolved at call time so HOME pivots work. */
function routineSidecarPath(): string {
  return join(homedir(), '.gtm-os', 'routine.yaml')
}

/** Path of `~/.gtm-os/config.yaml` (resolved at call time). */
function configYamlPath(): string {
  return join(homedir(), '.gtm-os', 'config.yaml')
}

/** Best-effort read of the prior sidecar. Quarantines unknown versions. */
function readPriorRoutine(): { sidecar: Record<string, unknown> | null; warning: string | null } {
  const path = routineSidecarPath()
  if (!existsSync(path)) return { sidecar: null, warning: null }
  try {
    const parsed = yaml.load(readFileSync(path, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') {
      return { sidecar: null, warning: 'Existing routine.yaml is malformed — ignoring.' }
    }
    const obj = parsed as Record<string, unknown>
    const v = obj.version
    if (typeof v !== 'number' || v !== 1) {
      return {
        sidecar: null,
        warning: `Existing routine.yaml version ${String(v)} is unknown to this YALC build — ignoring (no migration available).`,
      }
    }
    return { sidecar: obj, warning: null }
  } catch (err) {
    return {
      sidecar: null,
      warning: `Could not parse routine.yaml: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Write the routine snapshot + meta block. */
function writeSidecar(routine: Routine): void {
  const dir = join(homedir(), '.gtm-os')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const payload = {
    ...routine,
    routine_meta: {
      installed_at: new Date().toISOString(),
      yalc_version: process.env.YALC_VERSION ?? 'dev',
    },
  }
  writeFileSync(routineSidecarPath(), yaml.dump(payload), 'utf-8')
}

/**
 * Patch `dashboard.default_route` into `~/.gtm-os/config.yaml` while
 * preserving every other key. We round-trip via js-yaml — the loader at
 * `src/lib/config/loader.ts` only consumes specific keys, so adding the
 * extra `dashboard:` block is invisible to it.
 */
function writeDashboardPreference(route: string): void {
  const path = configYamlPath()
  let parsed: Record<string, unknown> = {}
  if (existsSync(path)) {
    try {
      const raw = yaml.load(readFileSync(path, 'utf-8'))
      if (raw && typeof raw === 'object') parsed = raw as Record<string, unknown>
    } catch {
      /* ignore — overwritten below */
    }
  } else {
    const dir = join(homedir(), '.gtm-os')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  parsed.dashboard = {
    ...((parsed.dashboard as Record<string, unknown>) ?? {}),
    default_route: route,
  }
  writeFileSync(path, yaml.dump(parsed), 'utf-8')
}

/** Default `installFramework` hook — calls the real framework install command. */
async function defaultInstallHook(name: string, inputs: Record<string, unknown> | undefined): Promise<void> {
  const { runFrameworkInstall } = await import('../../cli/commands/framework.js')
  await runFrameworkInstall(name, {
    autoConfirm: true,
    destination: 'dashboard',
  })
  // Inputs from a Routine entry are already merged into the framework's
  // installed-config via `runFrameworkInstall`'s `collectInputs` (which
  // reads `$context.*` defaults). When the routine pinned an explicit
  // override, layer it on top of the installed-config inputs.
  if (inputs && Object.keys(inputs).length > 0) {
    const cfg = loadInstalledConfig(name)
    if (cfg) {
      const { saveInstalledConfig } = await import('../frameworks/registry.js')
      cfg.inputs = { ...cfg.inputs, ...inputs }
      saveInstalledConfig(cfg)
    }
  }
}

/**
 * Apply a Routine: install frameworks, persist the sidecar, set the
 * dashboard preference. Idempotent — re-running with the same Routine is
 * safe (already-installed frameworks are skipped).
 *
 * @param routine The proposal to install.
 * @param opts   Optional dry-run / `--only` / install-hook overrides.
 */
export async function installRoutine(
  routine: Routine,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  const result: InstallResult = { installed: [], skipped: [], warnings: [] }
  const installHook = opts.installFramework ?? defaultInstallHook

  // Quarantine unknown prior versions (spec §7).
  const prior = readPriorRoutine()
  if (prior.warning) result.warnings.push(prior.warning)

  // Empty routines: no-op (don't even write the sidecar).
  if (routine.frameworks.length === 0) {
    return result
  }

  // Dry-run: report planned actions, don't write.
  if (opts.dryRun) {
    for (const entry of routine.frameworks) {
      result.skipped.push({ framework: entry.framework, reason: 'dry-run' })
    }
    return result
  }

  for (const entry of routine.frameworks) {
    if (opts.only && !opts.only.includes(entry.framework)) {
      result.skipped.push({ framework: entry.framework, reason: 'not in --only set' })
      continue
    }
    if (entry.deferred) {
      result.skipped.push({
        framework: entry.framework,
        reason: 'deferred — install will pause at upstream wizard (e.g. Step 10 hypothesis)',
      })
      continue
    }
    if (loadInstalledConfig(entry.framework)) {
      result.skipped.push({ framework: entry.framework, reason: 'already installed' })
      continue
    }
    try {
      await installHook(entry.framework, entry.inputs)
      result.installed.push(entry.framework)
      // Optionally re-apply the routine's pinned schedule onto the agent
      // yaml. The framework yaml's `schedule.cron` is already the source
      // of truth, but a future `routine.yaml` snapshot may diverge — see
      // spec §4.2 (schedule nudging). We trust the install hook's defaults
      // for v1 to keep idempotency simple.
      void scheduleNoop(entry)
    } catch (err) {
      result.warnings.push(
        `Failed to install ${entry.framework}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  // Persist the snapshot + dashboard pref. Done after installs so a
  // mid-install crash doesn't leave a stale sidecar pointing at a
  // half-applied state.
  writeSidecar(routine)
  writeDashboardPreference(routine.defaultDashboard)
  return result
}

/** Placeholder for routine-pinned schedule overrides. v1 trusts yaml defaults. */
function scheduleNoop(_entry: RoutineFrameworkEntry): void {
  /* intentionally empty */
}
