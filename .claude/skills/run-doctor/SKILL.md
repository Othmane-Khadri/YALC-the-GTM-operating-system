---
name: run-doctor
description: "Run the GTM-OS health check across all 5 diagnostic layers (environment, database, configuration, provider connectivity, runtime state). Use when the user says 'is YALC working', 'diagnose YALC', 'check YALC health', 'is everything configured', 'run the health check', or 'are my keys set up'. Read-only — never writes anything. Surfaces /keys/connect/<provider> URLs alongside any failed provider so the user has a one-click path to fix."
version: 1.0.0
---

# Run Doctor

I'll run the 5-layer health check and tell you what's missing. This is the read-only diagnostic that proves YALC is wired up correctly — environment file, SQLite schema, framework + user config, live provider connectivity, and runtime state. Nothing here writes to disk or burns credits.

## When This Skill Applies

Use this skill when the user says:

- "is YALC working"
- "diagnose YALC"
- "check YALC health"
- "is everything configured"
- "run the health check"
- "are my keys set up"

**NOT this skill** (use `debugger` instead):
- A specific command failed — debugger walks the error funnel layer by layer.
- "fix", "not working", "broken", "troubleshoot" — those route to debugger.

**NOT this skill** (use `setup` instead):
- "set up YALC" — that's the onboarding flow.

## What This Skill Does

1. Imports the `runDoctor` function from `src/lib/diagnostics/doctor.ts` directly (no fresh CLI subprocess).
2. Captures the printed health check output by intercepting `console.log` and `process.exit`.
3. Renders a clean per-layer summary: PASS / FAIL / WARN / SKIP for each check.
4. For any FAIL'd or WARN'd provider, surfaces the matching `/keys/connect/<provider>` URL (the URL hint A5 added).
5. Offers to walk you through fixing each failure — typically by opening the relevant `/keys/connect/...` route in your browser via `yalc-gtm dashboard --route /keys/connect/<provider>`.

## What This Skill Does NOT

- Modify env files, configs, or the database. Read-only.
- Send any external requests beyond the live provider probes that doctor itself runs.
- Auto-fix anything. All fixes need your approval.

## Workflow

### Step 0: No user input needed

This is a read-only command. Skip straight to step 1.

### Step 1: Generate the inline runner

Generate `/tmp/yalc-skill-run-doctor.mjs` from the gtm-os root (`~/Desktop/gtm-os/`). The runner imports `runDoctor` directly (the import-direct pattern from 0.13.0), monkey-patches `console.log` and `process.exit` so the output is collected as structured lines, and prints JSON to stdout.

**Important — the import path must be absolute.** `tsx` resolves relative imports against the script's own directory, not against `cwd`. Since the runner lives in `/tmp/`, a relative `./src/...` import resolves to `/tmp/src/...` and fails. Build the runner with the absolute path baked in via heredoc expansion:

```bash
cd ~/Desktop/gtm-os && cat > /tmp/yalc-skill-run-doctor.mjs <<RUNNEREOF
import { runDoctor } from '\${PWD}/src/lib/diagnostics/doctor.ts'

const lines = []
const origLog = console.log
const origExit = process.exit

console.log = (...args) => {
  lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
}

let exitCode = 0
process.exit = (code) => {
  exitCode = typeof code === 'number' ? code : 0
}

let runError = null
try {
  await runDoctor({ report: false })
} catch (err) {
  runError = err instanceof Error ? { message: err.message, stack: err.stack } : { message: String(err) }
}

console.log = origLog
process.exit = origExit

process.stdout.write(JSON.stringify({ exitCode, runError, lines }, null, 2))
process.stdout.write('\n')
RUNNEREOF
```

Note: do **not** add a `--json` flag — `runDoctor` does not accept one; this wrapper is how we get JSON.

### Step 2: Run it

From the gtm-os root (`~/Desktop/gtm-os/`):

```bash
npx tsx /tmp/yalc-skill-run-doctor.mjs
```

### Step 3: Parse the JSON output

The runner emits `{ exitCode, runError, lines }`. The `lines` array is the verbatim sequence of `console.log` calls doctor made — including the layer headers (`── Environment ──`, `── Database ──`, etc.), the per-check rows (`  ✓ [OK  ] ANTHROPIC_API_KEY`, `  ✗ [FAIL] Crustdata`), and the summary block.

Parse it like this:

- A line starting with `── ` and ending with ` ──` opens a new layer.
- A line starting with `  ✓ [OK  ]`, `  ✗ [FAIL]`, `  ! [WARN]`, or `  ✓ [SKIP]` is a check row. The bracketed token is the status; the rest is the check name.
- Indented lines (prefix `           `) that follow a non-PASS check carry the detail/explanation.
- The summary lines (`X passed, Y failed, Z warnings, W skipped`) appear under `── Summary ──`.
- A trailing line of MCP-loader noise (`[mcp-loader] ...`) may appear between the layer headers — ignore it.

### Step 4: Render a clean diagnosis

Group checks by layer. For each layer, list the checks in order with their status. For any check whose detail contains `Fix: http://localhost:3847/keys/connect/<provider>`, surface the URL prominently next to the failing line.

See `references/example-output.md` for a full rendered example.

End the summary with the overall verdict: healthy / minor warnings / N issues need attention.

### Step 5: Offer to fix any FAIL or provider-related WARN

For each FAIL or WARN row whose detail includes a `/keys/connect/<provider>` URL, ask the user:

> "Want me to open `/keys/connect/<provider>` in your browser? I'll run `yalc-gtm dashboard --route /keys/connect/<provider>`."

Don't run the dashboard command unless they say yes. The dashboard command (A2) starts the SPA on port 3847 and routes the user to the connect screen for that provider.

For non-provider failures (missing `.env` file, missing core tables, malformed YAML), surface the specific recovery hint the doctor itself emitted in the detail line — those are already actionable.

### Step 6: Fallback path

If the inline runner errors out (e.g., the import path moves, the function signature changes, an unhandled exception escapes `runDoctor`), fall back to the CLI:

```bash
npx tsx src/cli/index.ts doctor
```

The CLI command takes only `--report` (no `--json` flag). Its stdout is the same human-readable output doctor would have printed; parse it the same way as the captured lines from the runner.

## Notes

- `runDoctor` accepts only `{ report?: boolean }`. There is no `{ json: true }` option. The inline runner is the JSON wrapper.
- The 5 layers are: Environment, Database, Configuration, Provider Connectivity, Runtime State. Two optional layers — Preview Confidence (when a `_preview/` folder exists) and Retired Frameworks (when ≥1 retired framework is installed) — appear only when relevant.
- Doctor never prints secrets. Env values are masked before any line is logged. Safe to re-render the lines verbatim.
- The `/keys/connect/<provider>` URLs hard-code `http://localhost:3847` — they're only useful once the dashboard is running.
- The runner's heredoc must use `'\${PWD}/...'` (single-quoted with escaped `$`) so the shell expands `$PWD` on write but the resulting JS file contains a literal absolute path. Inside JS, plain string literal syntax — no template literal needed.
