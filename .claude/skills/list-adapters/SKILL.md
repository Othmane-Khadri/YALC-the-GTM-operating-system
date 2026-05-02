---
name: list-adapters
description: "Show every capability the engine knows about and which provider backs it (built-in TypeScript, bundled YAML, or user-installed YAML), with availability flags reflecting whether each provider's API key is set. Use when the user says 'list adapters', 'show me which providers are configured', 'which providers are available', 'what capabilities can YALC use right now', or 'show capability coverage'. Read-only — never writes anything."
version: 1.0.0
---

# List Adapters

I'll show you every capability the engine recognizes and which provider currently backs it. This is the read-only inventory that proves YALC's adapter registry is correctly wired and tells you which capabilities are actually executable on your machine.

## When This Skill Applies

Use this skill when the user says:

- "list adapters"
- "show me which providers are configured"
- "which providers are available"
- "what capabilities can YALC use right now"
- "show capability coverage"

**NOT this skill** (use `provider-builder` instead):
- "add a new provider for X" — provider-builder authors a fresh YAML manifest.
- "wire up [vendor] to YALC" — same.

**NOT this skill** (use `run-doctor` instead):
- "is YALC working" / "diagnose YALC" — run-doctor is the broader 5-layer health check; this skill only inventories adapters.

## What This Skill Does

1. Runs `yalc-gtm adapters:list --json` to get the structured adapter registry.
2. Parses the JSON and renders it grouped by capability.
3. For each capability, lists every provider the engine knows about with its source tag — `[built-in]` (TypeScript), `[bundled]` (YAML shipped with YALC under `configs/adapters/`), or `[user]` (YAML the user dropped in `~/.gtm-os/adapters/`).
4. Marks each provider with availability — `✓` if every required env var is set, `✗` if any required key is missing.
5. Surfaces which provider wins resolution for each capability based on the user's `~/.gtm-os/config.yaml` priority list (or the default priority if no override).

## What This Skill Does NOT

- Modify the registry, env files, or any config. Read-only.
- Smoke-test live vendor endpoints. That's `adapters:smoke <path>`.
- Auto-install missing providers. Use `provider-builder` (author a new YAML) or `provider:install <capability>/<provider>` (fetch from `providers/manifests/`).

## Pre-flight (do this before step 1)

**Onboarding interruption guard.** Run:

```bash
test -f ~/.gtm-os/.in-flight-setup && echo "BLOCKED" || echo "OK"
```

If `BLOCKED`, surface a soft warning: setup is mid-flight, so the adapter inventory may not yet reflect freshly-set keys or newly-installed manifests. Since this skill is read-only and never writes anything, ask the user whether to (a) run anyway against the in-flight state, or (b) finish `yalc-gtm setup --resume` first and re-invoke. Default to (b) unless the user explicitly opts in to (a).

## Workflow

### Step 0: No user input needed

This is a read-only command. Skip straight to step 1.

### Step 1: Run the CLI

From the gtm-os root (`~/Desktop/gtm-os/`):

```bash
npx tsx src/cli/index.ts adapters:list --json
```

The `--json` flag emits a structured payload instead of the human-readable table. Per the 0.13.0 benchmark, single-command skills like this one shell out unconditionally — the import-direct path saves only ~10ms here, not worth the maintenance cost. Use the import-direct pattern only for chained skills (see `docs/skills-architecture.md`).

### Step 2: Parse the JSON output

The CLI emits `{ rows: Array<{ capability, providers: Array<{ id, source, available, priorityIndex?, manifestPath? }> }>, declarativeErrors: Array<...> }`.

- `capability` is the capability id (e.g., `icp-company-search`, `crm-contact-upsert`).
- `providers[].source` is `'built-in'`, `'bundled'`, or `'user'`.
- `providers[].available` is `true` if every env var the adapter needs is set, `false` otherwise.
- `providers[].priorityIndex` is the resolution rank (1 = first chosen). Providers without an index are registered but not in the priority list.
- `declarativeErrors` lists any YAML manifests that failed to compile at boot — surface these prominently if non-empty.

### Step 3: Render a clean inventory

Group by capability. For each capability, list every provider in priority order followed by any non-prioritized entries. Use the format shown in `references/example-output.md`:

```
icp-company-search
  #1  ✓ crustdata            [built-in]
  #2  ✓ apollo               [built-in]
  ·   ✗ pappers              [built-in]
```

`#N` is the priority rank. `·` marks providers registered but not in the priority list. `✓` / `✗` reflects availability.

End the summary with a one-line verdict: how many capabilities have at least one available provider, and how many don't (these are the gaps the user might want to fill).

### Step 4: Surface declarative errors

If the JSON includes any `declarativeErrors` entries, render them after the inventory. Each error has the manifest path and the validation message. These are user-actionable — the user dropped a malformed YAML in `~/.gtm-os/adapters/` and the engine refused to compile it.

### Step 5: Offer follow-ups

If any capability has zero available providers, ask:

> "Want me to add a provider for `<capability>`? I can run `provider-builder` to author a new YAML manifest from a vendor docs URL."

If a bundled provider exists but its key isn't set, suggest the relevant `/keys/connect/<provider>` URL via the dashboard command:

> "`<provider>` is bundled but `<ENV_VAR>` isn't set. Want me to open `/keys/connect/<provider>` in your browser? I'll run `yalc-gtm dashboard --route /keys/connect/<provider>`."

Don't run anything unless they say yes.

## Notes

- The CLI's `--json` flag was added in 0.11.0 alongside the declarative adapter loader (B2). It's stable and parseable.
- This skill never imports the registry directly. The benchmark in `docs/skills-architecture.md` shows the import-direct gain on a single-command read is negligible (~10ms); shell-out keeps the skill body simple and uses the same code path as anyone running the CLI manually.
- The CLI is the source of truth for resolution logic — including override semantics (declarative wins over built-in for the same `(capability, provider)`). Don't second-guess the registry's output here.
