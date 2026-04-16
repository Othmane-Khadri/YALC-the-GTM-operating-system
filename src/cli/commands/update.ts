import { execSync } from 'child_process'
import { resolve } from 'path'

/**
 * Self-update: pull latest code from origin without breaking local config.
 * User data lives in ~/.gtm-os/ (untouched). Only the repo source is updated.
 */
export async function runUpdate() {
  const root = resolve(__dirname, '..', '..', '..')
  const run = (cmd: string) =>
    execSync(cmd, { cwd: root, encoding: 'utf-8', stdio: 'pipe' }).trim()

  const currentCommit = run('git rev-parse --short HEAD')

  // 1. Check for local modifications
  const dirty = run('git status --porcelain')
  const hadStash = dirty.length > 0

  if (hadStash) {
    console.log('[update] Stashing your local changes...')
    run('git stash push -m "yalc-gtm-update-autostash"')
  }

  // 2. Pull latest
  try {
    console.log('[update] Pulling latest from origin...')
    const pullOutput = run('git pull --rebase origin main')
    console.log(`  ${pullOutput}`)
  } catch (err: any) {
    // Restore stash before bailing
    if (hadStash) {
      try { run('git stash pop') } catch { /* best effort */ }
    }
    console.error('[update] Failed to pull. Check your network or git remote.')
    console.error(`  ${err.message?.split('\n')[0] ?? err}`)
    process.exit(1)
  }

  // 3. Install deps (in case package.json changed)
  try {
    console.log('[update] Installing dependencies...')
    run('pnpm install --frozen-lockfile 2>/dev/null || pnpm install')
  } catch {
    console.log('[update] pnpm install had warnings (non-fatal)')
  }

  // 4. Re-link CLI globally
  try {
    run('pnpm link --global')
  } catch {
    // Non-fatal — may already be linked
  }

  // 5. Restore stash
  if (hadStash) {
    try {
      console.log('[update] Restoring your local changes...')
      run('git stash pop')
    } catch {
      console.warn(
        '\n⚠  Stash pop had conflicts. Your changes are saved in git stash.',
      )
      console.warn('   Run `git stash show -p` to see them, then resolve manually.')
    }
  }

  // 6. Summary
  const newCommit = run('git rev-parse --short HEAD')
  if (currentCommit === newCommit) {
    console.log(`\n[update] Already up to date (${newCommit}).`)
  } else {
    // Show what changed
    const log = run(`git log --oneline ${currentCommit}..${newCommit}`)
    const commitCount = log.split('\n').filter(Boolean).length
    console.log(`\n[update] Updated ${currentCommit} → ${newCommit} (${commitCount} new commit${commitCount === 1 ? '' : 's'})`)
    console.log(log.split('\n').map(l => `  ${l}`).join('\n'))
  }

  console.log('[update] Your ~/.gtm-os/ config is untouched.')
}
