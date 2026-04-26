/**
 * TTY guard for interactive commands.
 *
 * Inquirer-driven flows (setup, onboard, configure, agent:create, etc.)
 * hang or throw confusing errors when stdin/stdout isn't a TTY (CI, piped
 * input, background launchd jobs). Call `requireTTY` at the entry of any
 * such command to fail fast with a friendly message.
 *
 * Pair with a `--non-interactive` flag at the command level so callers
 * who pre-supply every required input via flags can opt out of the guard.
 */

export function requireTTY(commandName: string): void {
  const stdinTTY = Boolean(process.stdin.isTTY)
  const stdoutTTY = Boolean(process.stdout.isTTY)
  if (stdinTTY && stdoutTTY) return

  console.error(
    `\n  ${commandName} needs an interactive terminal.\n\n` +
      '  This command prompts for input via stdin. Run it directly in your\n' +
      '  shell, not through a pipe, redirect, or background process.\n\n' +
      '  Already pre-supplying every required input as flags? Re-run with\n' +
      '  --non-interactive to skip the prompts.\n'
  )
  process.exit(1)
}
