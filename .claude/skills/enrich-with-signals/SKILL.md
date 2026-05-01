---
name: enrich-with-signals
description: "Pull PredictLeads buying-intent signals (jobs, news, funding, tech, leadership changes) for a result set of companies and write them back into the local cache. Use when the user says 'enrich these companies with signals', 'add buying signals to this list', 'pull intent data for [domain]', 'check signals for these accounts', or 'fetch jobs and news for these companies'. Side-effecting — calls PredictLeads API and writes to local SQLite + JSON cache."
version: 1.0.0
---

# Enrich With Signals

I'll wrap `signals:enrich`. Take a result set, fan out PredictLeads calls (cached 7 days per domain), and surface signal counts + summary per company.

## When This Skill Applies

- "enrich these companies with signals"
- "add buying signals to this list"
- "pull intent data for [domain]"
- "check signals for these accounts"
- "fetch jobs and news for these companies"

**NOT this skill** (use `find-lookalikes` instead):
- "find similar companies" — that discovers new prospects.

**NOT this skill** (use `qualify-leads --enrich-signals` instead):
- "qualify these leads with signals" — that's the qualification pipeline with signal enrichment as a gate.

## Workflow

### Step 0 — Ask which result set

> "Which result set should I enrich? Pass the id, or use the most recent."

### Step 1 — Validate result set exists

### Step 2 — Ask which signal types

> "Which signal types? (default: jobs, funding, tech, news; also available: leadership)"

### Step 3 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts signals:enrich --result-set <id> --types <types>
```

Side-effecting → shell-out per benchmark.

### Step 4 — Parse output

CLI emits per-company signal counts + cache hit ratio + total credits consumed.

### Step 5 — Render

See `references/example-output.md`.

### Step 6 — Offer follow-ups

> "Want me to (a) qualify the enriched set via `qualify-leads`, (b) launch a campaign segmented by signal type?"

## Notes

- ~1 PredictLeads credit per uncached domain per signal type.
- 7-day cache TTL; pass `--no-cache` to force re-fetch.
- Companies with no signals get an empty entry (still cached so we don't re-query).
