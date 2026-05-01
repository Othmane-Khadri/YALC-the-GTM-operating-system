---
name: predictleads-signals
description: Use when a teammate wants ad-hoc PredictLeads signals for a single company, asks "what's happening at [company]", "signals for [domain]", "enrich [domain] with PredictLeads", "pull jobs/funding/news for [company]", or wants to read previously cached signals from local SQLite without burning new credits.
---

# PredictLeads Signals (single company)

Pulls and reads company-level intent signals from PredictLeads: job openings, financing events, technologies, news events, similar companies. Stored in local SQLite (`company_signals` table) with a 7-day TTL cache so repeat lookups within the week cost zero credits.

## When to use

- Quick lookup before an outbound message: "what's happening at hubspot.com?"
- Adding signal context to a single lead during qualification
- Reading cached signals offline (no API call) via `signals:show`
- Sanity-checking a company's marketing maturity (tech stack, hiring pace)

**Don't use when:** enriching a list of >5 companies (use `predictleads-lookalikes` for discovery, or the bulk `signals:enrich --result-set`); building a campaign (use `prospect-discovery-pipeline`).

## Quick reference

```bash
# Pull all 4 signal types for one company (1 credit per type = 4 credits)
npx tsx src/cli/index.ts signals:fetch --domain hubspot.com

# Restrict to specific types (saves credits)
npx tsx src/cli/index.ts signals:fetch --domain hubspot.com --types jobs,funding

# Force re-fetch even if cached within TTL
npx tsx src/cli/index.ts signals:fetch --domain hubspot.com --no-cache

# Read cached signals locally (no API call, free)
npx tsx src/cli/index.ts signals:show --domain hubspot.com --limit 20
npx tsx src/cli/index.ts signals:show --domain hubspot.com --type news
```

## Cost

| Operation | Credits |
|---|---|
| `signals:fetch` (4 types, default) | 4 |
| `signals:fetch --types jobs,funding` | 2 |
| `signals:fetch` re-run within 7 days | 0 (cache hit) |
| `signals:show` | 0 (local read) |

Live PredictLeads quota: hit `/api_subscription` once via curl to see remaining credits. Or just run `signals:fetch` and the output prints cache hit / +N signals per type.

## Signal types and aliases

`jobs` (job_opening), `funding` (financing), `tech` (technology), `news`, `similar` (similar_company)

## Common pitfalls

- **Domain format**: pass the bare domain (`hubspot.com`), not `https://hubspot.com` or `www.hubspot.com`. The service tolerates either but URLs in payloads are cleaner.
- **News and tech rows look empty in `signals:show`**: payloads use `summary` (news) and resolved relationships (tech) instead of `title`. The display already falls through to `summary`. If you see blanks, check the raw payload via `sqlite3 ~/.gtm-os/gtm-os.db "SELECT payload FROM company_signals WHERE domain='X' LIMIT 1"`.
- **Cache invalidation**: 7 days is the default TTL. Pass `--no-cache` to force a refresh. Caching is per (domain, signal_type), so refreshing news doesn't re-pull jobs.

## Required env

`PREDICTLEADS_API_KEY` + `PREDICTLEADS_API_TOKEN` in `~/.gtm-os/.env`. Both come from the same PredictLeads subscription page. See `TEAM_SETUP.md` at repo root for how to get them.
