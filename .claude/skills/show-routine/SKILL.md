---
name: show-routine
description: "Show the proposed sales routine without installing it — read-only preview of which frameworks YALC would auto-configure, with schedules and rationale, based on current archetype + providers + context. Use when the user says 'show my routine', 'what would YALC propose', 'preview the routine', 'dry-run the routine generator', or 'just show me the proposal'. Read-only — never writes anything."
version: 1.0.0
---

# Show Routine

I'll wrap `routine:propose` in read-only mode. Same generator as `build-routine`, but no install offer — just the proposal for inspection.

## When This Skill Applies

- "show my routine"
- "what would YALC propose"
- "preview the routine"
- "dry-run the routine generator"
- "just show me the proposal"

**NOT this skill** (use `build-routine` instead):
- "build my routine" / "set up my routine" — that proposes AND offers to install.

## Workflow

### Step 0 — No input needed

### Step 1 — Shell out (single command, per benchmark)

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts routine:propose --json
```

Single-command read-only → shell-out per benchmark (saves 10ms vs import-direct, not worth the maintenance complexity here since `build-routine` already showcases the hybrid).

### Step 2 — Parse JSON

Same shape as `build-routine`'s propose runner output: frameworks + schedules + dashboard + rationale.

### Step 3 — Render

Show the proposal. Mark deferred entries explicitly. Don't ask about installation.

### Step 4 — Tell the user how to install if they want

> "If you want to install this routine, run the `build-routine` skill (it's the same proposal + install path)."

## Notes

- This is the read-only sibling of `build-routine`.
- Useful when the user wants to audit the proposal before committing — e.g., compare against an existing routine.
- Routine generation is deterministic so this output is stable for the same inputs.
