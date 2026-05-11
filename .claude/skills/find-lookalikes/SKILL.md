---
name: find-lookalikes
description: "Find companies similar to a seed domain via PredictLeads' similar_companies endpoint and persist them as a result set ready for enrichment or qualification. Use when the user says 'find lookalikes for [domain]', 'companies similar to [name]', 'show me lookalike accounts', 'expand from this company', or 'discover similar prospects'. Side-effecting — calls PredictLeads API and writes to local cache."
version: 1.0.0
---

# Find Lookalikes

I'll wrap `signals:similar`. Ask for a seed domain, shell out to PredictLeads, dedupe + cache, and surface the lookalike list as a result set.

## When This Skill Applies

- "find lookalikes for [domain]"
- "companies similar to [name]"
- "show me lookalike accounts"
- "expand from this company"
- "discover similar prospects"

**NOT this skill** (use `prospect-discovery-pipeline` instead):
- "find prospects like our best client" — that's the full 5-phase orchestrator (lookalikes → ICP filter → CMO finder → signals → variants).

**NOT this skill** (use `enrich-with-signals` instead):
- "enrich these companies with PredictLeads signals" — that pulls jobs/news/funding/tech for an EXISTING list.

## Workflow

### Step 0 — Ask for seed domain

> "What's the seed domain or company URL?"

### Step 1 — Validate (basic domain format)

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts signals:similar --domain <domain>
```

Single-command side-effecting → shell out per the benchmark.

### Step 3 — Parse output

The CLI emits the lookalike list + result set id + cache hit/miss flags.

### Step 4 — Render

See `references/example-output.md`.

### Step 5 — Offer follow-ups

> "Want me to (a) enrich these with signals via `enrich-with-signals`, (b) qualify them via `qualify-leads`?"

## Notes

- Requires `PREDICTLEADS_API_KEY` in `~/.gtm-os/.env`.
- Cached 7 days per seed domain.
- ~1 PredictLeads credit per call.
