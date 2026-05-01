# build-routine — example rendered output

Hybrid flow showing both phases (propose import-direct ~700ms, install shell-out).

## Step 1 — PROPOSE (import-direct, ~700ms median)

Runner output (JSON parsed and rendered):

```
Proposed sales routine
  Archetype: B (content-calendar-builder anchor) + C (outreach deferred)
  Generated in 712ms (import-direct)

Frameworks:
  ✓ content-calendar-builder
      Schedule: weekly Mon 09:00 PT
      Rationale: Anthropic key + monitoring keywords present.

  ✓ outbound-signals-radar
      Schedule: daily 06:00 PT
      Rationale: Crustdata + PredictLeads available; segment-fit signals enabled.

  ⏸ outreach-campaign-builder  (deferred)
      Reason: no outbound hypothesis recorded yet.
      Unblock: run `framework:set-hypothesis outreach-campaign-builder ...`
               or finish setup Step 10.

Default dashboard: /dashboard/b
```

## Step 3 — User confirms

```
> install
```

## Step 4 — INSTALL (shell-out)

```
$ npx tsx src/cli/index.ts routine:install --yes

✓ Installed: content-calendar-builder (Mon 09:00 PT)
✓ Installed: outbound-signals-radar (daily 06:00 PT)
⏸ Skipped (deferred): outreach-campaign-builder

✓ Pinned dashboard: /dashboard/b
✓ Wrote ~/.gtm-os/routine.yaml (version 1)
```

## Step 5 — Skill renders summary

```
Routine installed.

  2 frameworks active:
    • content-calendar-builder — Mon 09:00 PT
    • outbound-signals-radar   — daily 06:00 PT

  1 framework deferred:
    • outreach-campaign-builder — needs hypothesis

  Dashboard pinned: /dashboard/b

Next moves:
  (a) Qualify leads with `qualify-leads`?
  (b) Open the dashboard with `yalc-gtm dashboard`?
  (c) Record an outbound hypothesis to un-defer outreach-campaign-builder?
```

## Latency win

| Pattern | Step 1 (propose) | Step 4 (install) | Total |
|---|---|---|---|
| All shell-out | ~775ms | ~775ms | ~1550ms |
| **Hybrid (this skill)** | ~712ms | ~775ms | ~1487ms |

The win on this skill is small (~60ms) because both phases run once. For routines that re-propose multiple times in one session (audit before commit), the hybrid saves ~700ms per re-propose cycle.

## Failure modes

### `gatherEnvironment` import broke

```
⚠ Import-direct runner failed: SyntaxError in generator.ts
Falling back to shell-out: yalc-gtm routine:propose --json
```

The skill auto-falls-back. The user sees the same proposal, just slower.

### No archetype pinned

```
⚠ No archetype recorded in ~/.gtm-os/config.yaml.

Pick one:
  A — competitor-audience-mining
  B — content-calendar-builder
  C — outreach-campaign-builder
  D — lead-magnet-builder

Or run setup to derive it.
```

### Install step fails

```
routine:install failed (exit 1):

Error: framework 'outbound-signals-radar' not in registry.

To fix: ensure your YALC version is ≥ 0.12.0 and the framework files are present.
```
