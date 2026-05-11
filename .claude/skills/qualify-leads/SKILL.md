---
name: qualify-leads
description: "Run the GTM-OS 7-gate qualification pipeline over a batch of leads from a CSV, JSON, Notion DB, profile-visitors export, post-engagers export, or an existing SQLite result set. Writes per-lead pass/fail data back into SQLite and returns a result-set id you can hand to the campaign launcher. Use when the user says 'qualify these leads', 'score this lead list', 'run the qualification pipeline', 'check if these leads are a fit', or 'qualify the engagers'. Side-effecting — writes to the local SQLite db."
version: 1.0.0
---

# Qualify Leads

I'll wrap `leads:qualify`. I'll ask for the input source and path, validate locally, run the CLI, parse the per-gate counts, and surface the result-set id so you can hand it to `launch-linkedin-campaign` or `personalize-message`.

## When This Skill Applies

Use this skill when the user says:

- "qualify these leads"
- "score this lead list"
- "run the qualification pipeline"
- "check if these leads are a fit"
- "qualify the engagers"

**NOT this skill** (use `personalize-message` instead):
- "personalize a message for this lead" — that wraps the `personalize` CLI and writes a single LinkedIn DM, it doesn't run the gate pipeline.
- "draft a DM for [lead]" — same.

**NOT this skill** (use `scrape-post-engagers` instead):
- "scrape engagers off this LinkedIn post" — that wraps `leads:scrape-post`. Run that first to produce an engagers JSON, then come back here to qualify it.

## What This Skill Does

1. Asks where the leads live (CSV path, JSON path, Notion DB id, visitors export, engagers export, or an existing result-set id).
2. Validates the input locally — file exists, Notion id has the right shape, result-set id format looks plausible.
3. Shells out to `npx tsx src/cli/index.ts leads:qualify <args>` from `~/Desktop/gtm-os/`.
4. Parses the CLI's stdout — the pipeline emits per-gate counters and the resultSetId.
5. Renders a clean per-gate summary, the result-set id, and the top hot leads.
6. Offers two follow-up moves: launch a campaign or personalize messages.

## What This Skill Does NOT

- Send any outbound messages. That's `launch-linkedin-campaign` (LinkedIn) or `send-cold-email` (email).
- Author personalized message bodies. That's `personalize-message`.
- Re-import data that's already a result set. If the user already has a resultSetId, pass `--result-set <id>` and skip `--source` / `--input`.
- Modify any `.env` file. If a key is missing, the CLI raises and we surface its stderr verbatim.

## Pre-flight (do this before step 1)

1. **Onboarding interruption guard.** Run:
   ```bash
   test -f ~/.gtm-os/.in-flight-setup && echo "BLOCKED" || echo "OK"
   ```
   If `BLOCKED`, stop. Tell the user: "Setup is mid-flight. Finish `yalc-gtm start` first, then re-invoke me." Exit cleanly.

2. Confirm cwd. All shell-outs assume `~/Desktop/gtm-os/`.

## Workflow

### Step 0 — Ask for input

One question at a time:

1. **Where do the leads live?** Five options:
   - CSV path (`--source csv --input <path>`)
   - JSON path (`--source json --input <path>`)
   - Notion DB id (`--source notion --input <db-id>`)
   - Profile-visitors export (`--source visitors --input <path>`)
   - Post-engagers export (`--source engagers --input <path>`)
   - Or "use the most recent result set" / a specific id (`--result-set <id>`, no `--source` / `--input`)

2. **Any toggles?** Ask only if volunteered:
   - `--dry-run` — preview without writing
   - `--no-dedup` — skip dedup gate
   - `--slack-confirm` — Slack for ambiguous dedup matches
   - `--enrich-signals` (+ `--signals-types <jobs,funding,tech,news>`) — pull PredictLeads after qualify

### Step 1 — Validate the input locally

- For `csv` / `json` / `visitors` / `engagers`: `test -f <path>` returns 0.
- For `notion`: 32-char hex (with or without dashes). Extract id from URL if needed.
- For `--result-set <id>`: format looks plausible.

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts leads:qualify --source <type> --input <path>
```

…or for an existing result set:

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts leads:qualify --result-set <id>
```

Per the merged 0.13.0 benchmark in `docs/skills-architecture.md`, **single-command side-effecting skills shell out unconditionally**. The CLI is the source of truth for env loading, tenant resolution, and the `withDiagnostics()` wrapper.

### Step 3 — Parse the output

`leads:qualify` writes `[qualify]` log lines to stdout, one per gate, plus the result-set id and survivor count. On non-zero exit, surface stderr **verbatim** — no summarising.

### Step 4 — Render

Show the per-gate funnel, result-set id, and top 5 hot leads. See `references/example-output.md`.

### Step 5 — Offer follow-ups

> "Want me to also:
> (a) launch a LinkedIn campaign for the qualified leads via `launch-linkedin-campaign`, or
> (b) personalize messages for the top N via `personalize-message`?"

Don't run anything unless the user says yes.

## Failure surfacing — verbatim, never summarised

When `leads:qualify` exits non-zero, paste its stderr unchanged. The CLI's messages are tested and stable.

## Notes

- Pipeline writes to `~/.gtm-os/gtm-os.db`. Side-effecting → Pattern A (shell-out) per the architecture doc.
- 7 gates: dedup → prequal → exclusion → company-fit → role-fit → ICP scoring → optional signal enrichment. See `src/lib/qualification/pipeline.ts`.
- `--enrich-signals` ≈ 1 PredictLeads credit per surviving domain (cached 7 days).
