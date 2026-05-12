import { execSync, spawnSync } from 'child_process'

const IS_WIN = process.platform === 'win32'

/**
 * Stage all changes, commit with "<branch>/<timestamp>", push, then open a
 * GitHub pull request from the current branch into main.
 *
 * Requires the `gh` CLI to be installed and authenticated.
 */
export async function runPublish() {
  const run = (cmd: string) =>
    execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim()

  // ── resolve branch & commit message ────────────────────────────────────────
  let branch: string
  try {
    branch = run('git rev-parse --abbrev-ref HEAD')
  } catch {
    console.error('[publish] Not inside a git repository.')
    process.exit(1)
  }

  if (branch === 'HEAD') {
    console.error('[publish] Detached HEAD — checkout a named branch first.')
    process.exit(1)
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const commitMsg = `${branch}/${timestamp}`

  // ── git add . ──────────────────────────────────────────────────────────────
  console.log('[publish] Staging all changes...')
  try {
    run('git add .')
  } catch (err: unknown) {
    console.error('[publish] git add failed.')
    console.error(`  ${firstLine(err)}`)
    process.exit(1)
  }

  // ── git commit ─────────────────────────────────────────────────────────────
  const status = run('git status --porcelain')
  if (!status.length) {
    console.log('[publish] Nothing to commit — working tree is clean.')
  } else {
    console.log(`[publish] Committing as "${commitMsg}"...`)
    try {
      run(`git commit -m "${commitMsg}"`)
    } catch (err: unknown) {
      console.error('[publish] git commit failed.')
      console.error(`  ${firstLine(err)}`)
      process.exit(1)
    }
  }

  // ── git push ───────────────────────────────────────────────────────────────
  console.log(`[publish] Pushing ${branch} to origin...`)
  const push = spawnSync('git', ['push', 'origin', branch], {
    stdio: 'inherit',
    shell: IS_WIN,
  })
  if (push.status !== 0) {
    console.error('[publish] git push failed.')
    process.exit(1)
  }

  // ── gh pr create ───────────────────────────────────────────────────────────
  console.log('[publish] Creating pull request into main...')

  // Check whether a PR already exists for this branch so we don't error.
  let prExists = false
  try {
    const existing = run(`gh pr view ${branch} --json url -q .url`)
    if (existing) {
      prExists = true
      console.log(`[publish] PR already exists: ${existing}`)
    }
  } catch {
    // no existing PR — continue
  }

  if (!prExists) {
    const pr = spawnSync(
      'gh',
      ['pr', 'create', '--base', 'main', '--head', branch, '--title', commitMsg, '--fill'],
      { stdio: 'inherit', shell: IS_WIN },
    )
    if (pr.status !== 0) {
      console.error('[publish] gh pr create failed. Make sure `gh` is installed and authenticated.')
      process.exit(1)
    }
  }

  console.log(`\n[publish] Done. Branch "${branch}" is up and a PR is open against main.`)
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.split('\n')[0]
}
