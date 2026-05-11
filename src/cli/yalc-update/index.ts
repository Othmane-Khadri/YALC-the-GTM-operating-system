import { execSync, spawnSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

function step(msg: string) {
  console.log(`\n${CYAN}${BOLD}→${RESET} ${msg}`)
}

function ok(msg: string) {
  console.log(`${GREEN}${BOLD}✓${RESET} ${GREEN}${msg}${RESET}`)
}

function warn(msg: string) {
  console.log(`${YELLOW}⚠  ${msg}${RESET}`)
}

function fail(msg: string) {
  console.error(`\n${RED}${BOLD}✗ Error:${RESET} ${RED}${msg}${RESET}`)
}

function hint(msg: string) {
  console.log(`  ${DIM}${msg}${RESET}`)
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
}

function pkgRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  // src/cli/yalc-update/index.ts → 3 levels up to package root
  return resolve(here, '..', '..', '..')
}

export async function runYalcUpdate() {
  const root = pkgRoot()

  // ── Step 1: checkout main ────────────────────────────────────────────────
  step('Switching to main branch…')
  try {
    const current = run('git rev-parse --abbrev-ref HEAD', root)
    if (current !== 'main') {
      const dirty = run('git status --porcelain', root)
      if (dirty) {
        warn('You have uncommitted changes. Stashing them before switching branches.')
        run('git stash push -m "yalc-update-autostash"', root)
      }
      run('git checkout main', root)
    }
    hint(`On branch: main`)
  } catch (err) {
    fail('Could not switch to main branch.')
    hint('Make sure you are inside the YALC repository and git is available.')
    hint(err instanceof Error ? err.message.split('\n')[0] : String(err))
    process.exit(1)
  }

  // ── Step 2: pull from origin/main ────────────────────────────────────────
  step('Pulling latest changes from origin/main…')
  const commitBefore = run('git rev-parse HEAD', root)

  try {
    run('git pull origin main', root)
  } catch (err) {
    fail('Failed to pull from origin/main.')
    hint('Check your network connection and git remote configuration.')
    hint(err instanceof Error ? err.message.split('\n')[0] : String(err))
    process.exit(1)
  }

  const commitAfter = run('git rev-parse HEAD', root)

  if (commitBefore === commitAfter) {
    console.log()
    ok('YALC is already up to date.')
    process.exit(0)
  }

  // Show what changed
  const shortBefore = commitBefore.slice(0, 7)
  const shortAfter = commitAfter.slice(0, 7)
  const changedFiles = run(
    `git diff --name-only ${commitBefore}..${commitAfter}`,
    root
  ).split('\n').filter(Boolean)

  hint(`${shortBefore} → ${shortAfter}  (${changedFiles.length} file${changedFiles.length === 1 ? '' : 's'} changed)`)

  // ── Step 2b: install new packages if needed ──────────────────────────────
  const lockfileChanged = changedFiles.some(
    (f) =>
      f === 'package.json' ||
      f === 'package-lock.json' ||
      f === 'pnpm-lock.yaml' ||
      f === 'yarn.lock'
  )

  if (lockfileChanged) {
    step('New packages detected — running pnpm install…')
    const install = spawnSync('npx', ['pnpm', 'install'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
    if (install.status !== 0) {
      fail('pnpm install failed.')
      hint('Fix the dependency issue above, then run `yalc-update` again.')
      process.exit(1)
    }
    ok('Dependencies installed.')
  }

  // ── Step 3: scaffold new folders / fields ────────────────────────────────
  step('Running yalc-gtm start --non-interactive to scaffold any new config…')
  hint('Existing setup will not be overwritten.')

  const scaffold = spawnSync('yalc-gtm', ['start', '--non-interactive'], {
    stdio: 'inherit',
    // Let the child process find yalc-gtm on PATH
    shell: process.platform === 'win32',
  })

  if (scaffold.status !== 0) {
    warn('yalc-gtm start returned a non-zero exit code.')
    hint('Your existing config is untouched. Check the output above for details.')
    // Non-fatal — scaffold errors should not block the update
  }

  // ── Step 4: done ─────────────────────────────────────────────────────────
  console.log()
  console.log(`${GREEN}${BOLD}╔══════════════════════════════════════╗${RESET}`)
  console.log(`${GREEN}${BOLD}║   YALC update complete!  🎉          ║${RESET}`)
  console.log(`${GREEN}${BOLD}╚══════════════════════════════════════╝${RESET}`)
  console.log()
  hint(`Updated to ${shortAfter}. Your ~/.gtm-os/ config is untouched.`)
  console.log()
}
