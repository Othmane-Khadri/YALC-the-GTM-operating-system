---
name: build-routine
description: "Auto-derive a complete sales routine — installed frameworks, schedules, and default dashboard — from your archetype, available providers, and rich context, then install it on confirmation. Hybrid runtime: the proposal is import-direct (~700ms median, deterministic rule-based), the install is shell-out (writes to ~/.gtm-os/routine.yaml + config.yaml). Use when the user says 'build my sales routine', 'show me what YALC would auto-configure', 'propose a routine for me', 'set up a sales routine', or 'auto-derive my routine'. Side-effecting on install only — propose is read-only."
version: 1.0.0
---

# Build Routine

I'll propose a complete sales routine — frameworks, schedules, dashboard pin — based on your archetype, configured providers, and captured context. You approve, I install. **Hybrid pattern**: propose is pure (import-direct) so it's instant; install is side-effecting (shell-out).

## When This Skill Applies

Use this skill when the user says:

- "build my sales routine"
- "show me what YALC would auto-configure"
- "propose a routine for me"
- "set up a sales routine"
- "auto-derive my routine"

**NOT this skill** (use `setup` instead):
- "set up YALC" / "/setup" — that's the full onboarding flow. This skill is the routine step inside it (or after it), not the whole onboarding.

**NOT this skill** (use `launch-linkedin-campaign` instead):
- "launch a campaign" — that's per-result-set outreach. This skill installs the framework that makes campaigns possible.

**NOT this skill** (use `qualify-leads` instead):
- "qualify these leads" — single pipeline run. This skill orchestrates the broader cadence.

## What This Skill Does

1. **Propose (import-direct).** Imports `generateRoutine` from `src/lib/routine/generator.ts`, gathers inputs (capabilities available, archetype, context, hypothesis-locked flag), and produces a `Routine` object with frameworks + schedules + dashboard pin + per-entry rationale.
2. Renders the proposal cleanly so you can audit each pick.
3. Asks: install / show only / cancel.
4. **Install (shell-out).** On "install", runs `npx tsx src/cli/index.ts routine:install --yes`. Writes `~/.gtm-os/routine.yaml` and pins the dashboard route in `~/.gtm-os/config.yaml`.
5. Renders install result + offers follow-ups.

## What This Skill Does NOT

- Run any of the proposed frameworks. Install ≠ execute. Frameworks run on their declared schedule (or via `framework:run` / `trigger`).
- Send outreach. That's `launch-linkedin-campaign`.
- Invent new frameworks. The proposal is over the existing framework registry.

## Pre-flight

```bash
test -f ~/.gtm-os/.in-flight-setup && echo "BLOCKED" || echo "OK"
```

If `BLOCKED`, stop and tell the user to finish `yalc-gtm start` first.

## Workflow

### Step 0 — No user input needed for the proposal

Routine generation is deterministic. Skip to Step 1.

### Step 1 — PROPOSE (import-direct, hybrid)

Per `docs/skills-architecture.md`, the propose step is import-direct because routine generation is pure (rule-based, no I/O after input gathering) and chained shell-outs cost ~2.6s per the benchmark.

Generate `/tmp/yalc-skill-build-routine-propose.mjs` from the gtm-os root:

```bash
cd ~/Desktop/gtm-os && cat > /tmp/yalc-skill-build-routine-propose.mjs <<'RUNNEREOF'
import { generateRoutine } from `${process.env.PWD}/src/lib/routine/generator.ts`
import { gatherEnvironment, loadCompanyContext } from `${process.env.PWD}/src/lib/frameworks/recommend.ts`
import { readArchetypePreference } from `${process.env.PWD}/src/lib/config/archetype-pref.ts`
import { loadOutboundHypothesis } from `${process.env.PWD}/src/lib/frameworks/outbound-hypothesis.ts`
import { getCapabilityRegistryReady } from `${process.env.PWD}/src/lib/providers/capabilities.ts`

const reg = await getCapabilityRegistryReady()
const capabilitiesAvailable = reg
  .list()
  .flatMap((c) => c.providers.filter((p) => p.available).map((p) => `${c.capability}/${p.id}`))
const archetype = readArchetypePreference()
const context = await loadCompanyContext()
const hypothesis = await loadOutboundHypothesis('outreach-campaign-builder')
const env = await gatherEnvironment()

const routine = generateRoutine({
  capabilitiesAvailable,
  envHasAnthropic: env.envHasAnthropic,
  archetype,
  context,
  hypothesisLocked: hypothesis !== null,
})

process.stdout.write(JSON.stringify(routine, null, 2))
process.stdout.write('\n')
RUNNEREOF
```

**Path note:** template literals with `${process.env.PWD}` resolve at script runtime to the gtm-os absolute path. `tsx` resolves relative imports against the script directory (`/tmp/`), not cwd, so absolute paths are required.

Run it:

```bash
cd ~/Desktop/gtm-os && npx tsx /tmp/yalc-skill-build-routine-propose.mjs
```

If the import-direct runner errors (e.g., a generator signature changed), fall back:

```bash
cd ~/Desktop/gtm-os && npx tsx src/cli/index.ts routine:propose --json
```

Same JSON shape, slower path.

### Step 2 — Render the proposal

Group by section:

- **Frameworks** — for each entry in `routine.frameworks`, show name + schedule + rationale. If `deferred: true`, mark it explicitly (e.g., outreach-campaign-builder defers when no hypothesis is locked).
- **Default dashboard** — show which `/dashboard/<archetype>` route the routine pins.
- **Archetypes covered** — show which of A/B/C/D fired predicates in this proposal.

See `references/example-output.md` for the rendered format.

### Step 3 — Ask the user

> "Install this routine? Choices:
>
> - **install** — `routine:install --yes` writes `~/.gtm-os/routine.yaml` + pins the dashboard. Idempotent.
> - **show only** — keep the proposal in chat, don't write anything.
> - **cancel** — discard."

### Step 4 — INSTALL (shell-out)

If user says install:

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts routine:install --yes
```

Optional flags if the user asks:

- `--dry-run` — print actions without writing
- `--only <name1,name2>` — install a subset of the proposed frameworks

Per `docs/skills-architecture.md`: install is side-effecting (DB + config writes) → always shell-out, regardless of pure/chained classification.

### Step 5 — Parse install output + render

The CLI prints per-entry status (installed, already-installed, skipped because deferred). Render cleanly.

### Step 6 — Offer follow-ups

> "Routine installed. Next moves:
> (a) Qualify your existing leads via `qualify-leads`?
> (b) Open the dashboard via `yalc-gtm dashboard`?
> (c) Lock an outbound hypothesis (Step 10 of setup) so outreach-campaign-builder un-defers?"

## Failure surfacing — verbatim

If either path errors, paste the stderr unchanged.

## Notes

- The proposal is deterministic: same inputs → same Routine. Re-running `routine:propose` is safe and cheap.
- Install is idempotent: re-running with the same Routine no-ops on already-installed frameworks.
- `routine.yaml` lives at `~/.gtm-os/routine.yaml`. The dashboard pin lands in `~/.gtm-os/config.yaml` under `dashboard.default_route`.
- The hybrid pattern earns its keep here because Step 1 (propose) and Step 4 (install) are chained for the user; with all-shell-out, this skill would cost ~1.5s instead of ~700ms.
