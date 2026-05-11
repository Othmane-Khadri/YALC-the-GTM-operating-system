import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const IS_WIN = process.platform === 'win32'

/**
 * Self-update. Detects how YALC was installed and routes accordingly:
 * - From source (a .git directory exists at the package root): pull from origin,
 *   reinstall deps, re-link the CLI globally.
 * - From npm (no .git): run `npm update -g yalc-gtm-os` so the user gets the
 *   latest published version.
 *
 * User data in ~/.gtm-os/ is never touched.
 */
export async function runUpdate() {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/cli/commands/update.ts → package root is 3 levels up
  const pkgRoot = resolve(here, '..', '..', '..')
  const isFromSource = existsSync(join(pkgRoot, '.git'))

  if (isFromSource) {
    runFromSourceUpdate(pkgRoot)
  } else {
    runNpmUpdate()
  }
}

function runFromSourceUpdate(root: string) {
  const run = (cmd: string) =>
    execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: 'pipe' }).trim()

  const currentCommit = run('git rev-parse --short HEAD')

  const dirty = run('git status --porcelain')
  const hadStash = dirty.length > 0

  if (hadStash) {
    console.log('[update] Stashing your local changes...')
    run('git stash push -m "yalc-gtm-update-autostash"')
  }

  try {
    console.log('[update] Pulling latest from origin...')
    const pullOutput = run('git pull --rebase origin main')
    console.log(`  ${pullOutput}`)
  } catch (err: unknown) {
    if (hadStash) {
      try { run('git stash pop') } catch { /* best effort */ }
    }
    console.error('[update] Failed to pull. Check your network or git remote.')
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ${message.split('\n')[0]}`)
    process.exit(1)
  }

  try {
    console.log('[update] Installing dependencies...')
    const install = spawnSync('npx', ['pnpm', 'install'], {
      cwd: root,
      stdio: 'inherit',
      shell: IS_WIN,
    })
    if (install.status !== 0) {
      console.log('[update] pnpm install had warnings (non-fatal)')
    }
  } catch {
    console.log('[update] pnpm install had warnings (non-fatal)')
  }

  try {
    spawnSync('npx', ['pnpm', 'link', '--global'], {
      cwd: root,
      stdio: 'inherit',
      shell: IS_WIN,
    })
  } catch {
    // Non-fatal — may already be linked
  }

  if (hadStash) {
    try {
      console.log('[update] Restoring your local changes...')
      run('git stash pop')
    } catch {
      console.warn('\n⚠  Stash pop had conflicts. Your changes are saved in git stash.')
      console.warn('   Run `git stash show -p` to see them, then resolve manually.')
    }
  }

  const newCommit = run('git rev-parse --short HEAD')
  if (currentCommit === newCommit) {
    console.log(`\n[update] Already up to date (${newCommit}).`)
  } else {
    const log = run(`git log --oneline ${currentCommit}..${newCommit}`)
    const commitCount = log.split('\n').filter(Boolean).length
    console.log(`\n[update] Updated ${currentCommit} → ${newCommit} (${commitCount} new commit${commitCount === 1 ? '' : 's'})`)
    console.log(log.split('\n').map((l) => `  ${l}`).join('\n'))
  }

  console.log('[update] Your ~/.gtm-os/ config is untouched.')
}

function runNpmUpdate() {
  console.log('[update] Detected npm-installed YALC. Pulling the latest published version...')
  const opts = { stdio: 'inherit' as const, shell: IS_WIN }
  const update = spawnSync('npx', ['pnpm', 'update', '-g', 'yalc-gtm-os'], opts)
  if (update.status !== 0) {
    // Some package managers don't move the global pin with `update`. Fall back.
    console.log('[update] Falling back to `npx pnpm install -g yalc-gtm-os@latest`...')
    const install = spawnSync('npx', ['pnpm', 'install', '-g', 'yalc-gtm-os@latest'], opts)
    if (install.status !== 0) {
      console.error('[update] pnpm update failed.')
      process.exit(1)
    }
  }
  console.log('[update] Done. Your ~/.gtm-os/ config is untouched.')
}
