---
name: predictleads-lookalikes
description: Use when a teammate wants to find companies similar to a known account, asks "find lookalikes for [domain]", "companies like [client]", "similar to [domain]", "competitors of [company]", or "expand the target list from [client]". Pure account discovery — no outreach drafting, no CMO finding.
---

# PredictLeads Lookalikes (account discovery)

Pulls up to 50 companies similar to a seed domain via PredictLeads' `similar_companies` endpoint. Returns ranked results with a similarity score (0–1) and (when available) a sentence explaining why each is similar. Cheapest possible discovery: 1 credit per seed domain.

## When to use

- Expanding a target list from a known anchor account ("find more like Workmotion")
- Sanity-checking that a prospect fits an existing client's pattern
- Building a watchlist of competitors for monitoring
- First step of `prospect-discovery-pipeline` (but use that skill if outreach is downstream)

**Don't use when:** you need contacts/CMOs at the lookalikes (use `prospect-discovery-pipeline`); you want signal data on a single known company (use `predictleads-signals`).

## Quick reference

```bash
# 50 lookalikes from a seed domain (1 credit)
npx tsx src/cli/index.ts signals:similar --domain workmotion.com --limit 50

# Tighter list (still 1 credit per call)
npx tsx src/cli/index.ts signals:similar --domain scayle.com --limit 20

# Read back from local SQLite (no API call)
npx tsx src/cli/index.ts signals:show --domain workmotion.com --type similar
```

## Cost

Always 1 credit per seed domain regardless of `--limit`. Result rows land in `company_signals` with `signal_type='similar_company'` and stay cached for 7 days.

## Output shape

Each result is a domain + score + reason:

```
deel.com (score=0.85)
remote.com (score=0.849)
oysterhr.com (score=0.848)  — Both provide global EOR services for distributed teams.
```

Reasons are populated for some seed domains and not others (PredictLeads inconsistent). Score above 0.80 typically means strong match in their model.

## Common pitfalls

- **Megacaps in results**: PredictLeads returns market peers including SAP, Microsoft, Google for many B2B SaaS seeds. Filter by hand or via Crustdata `company_identify` before going further.
- **Multiple seed merge**: if you run two seeds (`workmotion.com` and `scayle.com`), results are stored separately by source domain. Dedupe in code or use `prospect-discovery-pipeline` which handles the merge.
- **`similar_company` rows have no event date**: they're a lookup, not an event. Don't sort by event_date; sort by score (in payload) or position.

## Required env

`PREDICTLEADS_API_KEY` + `PREDICTLEADS_API_TOKEN` in `~/.gtm-os/.env`. See `TEAM_SETUP.md`.
