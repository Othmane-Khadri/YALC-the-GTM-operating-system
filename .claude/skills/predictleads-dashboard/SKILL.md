---
name: predictleads-dashboard
description: Use when a teammate wants to visually browse PredictLeads signals already cached in local SQLite — triggers include "dashboard for [domains]", "visualize signals for [list]", "show signals as a dashboard", "HTML view of [client lookalikes]", or any request to scan many companies' signals at a glance.
---

# PredictLeads Dashboard (HTML viz)

Generates a single self-contained HTML page from cached signals in `~/.gtm-os/gtm-os.db`. Cards per company with signal-count badges, top-signal callout, expandable detail (recent jobs, news, funding, tech stack, similar companies). Filter by vertical, sort by signal density or recency. Auto dark/light. Zero API calls.

## When to use

- After running `prospect-discovery-pipeline` to scan all 10 finalists in one view
- After bulk-enriching a campaign result set (`signals:enrich --result-set`) for a visual sanity check before outreach
- Sharing signal context with a non-technical teammate (open the HTML, no CLI knowledge needed)

**Don't use when:** you only have signals for 1–2 companies (just use `signals:show`); signals haven't been pulled yet (run `signals:fetch` first).

## How to invoke

The dashboard is built by a small Python script. Pass a list of domains and an optional list of pre-built lead cards (name + title + LinkedIn URL).

### Inputs the skill needs

1. List of domains (must already be in `company_signals` table)
2. Optional per-domain lead metadata: `{ company, vertical, geo, lead_name, lead_title, linkedin }`

### Build steps

1. Read the lead metadata into a Python dict (see existing template at `~/Desktop/predictleads-dashboard.html` for shape).
2. Query SQLite for each domain:
   - `SELECT signal_type, COUNT(*)` for badge counts
   - Top 8 jobs by `event_date DESC`
   - Top 8 news by `event_date DESC`
   - Top 5 financing events
   - Top 12 technologies
   - Top 10 similar_companies sorted by `payload.score`
3. Render the HTML template (see `Implementation` below) with embedded JSON.
4. Write to `~/Desktop/predictleads-dashboard-{client_or_topic}-{date}.html` and open it.

## Implementation

A Python generator script lives at `scripts/predictleads-dashboard.py` (when committed). It reads from `~/.gtm-os/gtm-os.db`, accepts a JSON config of leads, and emits a self-contained HTML file.

If the script is missing, model the new one on the prior run captured at `~/Desktop/predictleads-dashboard.html` (Apr 30 2026). Key visual elements to keep:

- Per-company card with company name + vertical tag (color-coded) + domain
- Marketing lead pinned at top of each card with LinkedIn link
- 5 signal-type badges with counts (`jobs / funding / news / tech / similar`)
- "Top signal" callout with the most recent dated signal across types
- Expandable detail section (jobs/news/financing/tech/similar lists)
- Filter pills (All / vertical) + sort pills (density / recency / vertical)

## Quick reference

```bash
# After signals:fetch has populated the cache for the domains you care about
python3 scripts/predictleads-dashboard.py \
  --domains personio.com,oysterhr.com,...,mirakl.com \
  --leads-json /tmp/leads.json \
  --out ~/Desktop/predictleads-dashboard.html
open ~/Desktop/predictleads-dashboard.html
```

## Common pitfalls

- **Empty cards**: signals haven't been fetched yet. Run `signals:fetch --domain X` first.
- **News headlines blank**: PredictLeads news payloads use `summary` not `title`. The template's display logic falls through `payload.title || payload.headline || payload.summary`.
- **Tech stack shows blanks**: technology names live in JSON:API `relationships.technology.data.id` resolved via `included[]`. The normalizer in `predictleads-enrichment.ts` already promotes `payload.technology` to a top-level string. Older signals fetched before the normalizer fix may have empty tech rows; re-fetch with `--no-cache`.
- **Similar companies show only score**: same root cause — re-fetch with `--no-cache` to populate the `similar_company` field with the resolved domain.

## Required env

None for generation (it's local-only). The signals must already be cached, which means `PREDICTLEADS_API_KEY` + `PREDICTLEADS_API_TOKEN` had to be set when the cache was populated.
