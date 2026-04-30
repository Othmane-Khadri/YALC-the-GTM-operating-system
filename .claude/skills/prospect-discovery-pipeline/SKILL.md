---
name: prospect-discovery-pipeline
description: Use when a teammate wants a full discovery-to-outreach pipeline anchored on existing clients. Triggers include "find prospects like [client]", "build a target list like [domain]", "lookalike discovery for [client]", "discovery to outreach for [criteria]", "10 companies similar to [X] with a CMO", or any multi-step request combining lookalike search + decision-maker identification + signal enrichment + LinkedIn variant drafting.
---

# Prospect Discovery Pipeline

End-to-end pipeline: PredictLeads lookalikes → ICP filter → Crustdata CMO finder → multi-signal enrichment → 2 LinkedIn variants drafted with per-lead personalization. Pauses for user review before any expensive operation. Always quotes credit cost up front.

## When to use

- Building a target account list anchored on 1–2 known clients
- Generating a campaign-ready batch (10–25 leads with full signal context)
- Producing 2 A/B-testable LinkedIn message variants tied to actual signal data per lead

**Don't use when:** ad-hoc lookup of one company (use `predictleads-signals`); just lookalike domains without contacts (use `predictleads-lookalikes`); enriching a list you already have qualified leads for (use `signals:enrich --result-set` directly).

## The 5-phase flow

Always follow this order. Quote credit cost before each phase.

### Phase 1 — Discovery (2 PL credits for 2 anchors)

```bash
npx tsx src/cli/index.ts signals:similar --domain anchor1.com --limit 50
npx tsx src/cli/index.ts signals:similar --domain anchor2.com --limit 50
```

Merge into a candidate pool, dedupe by domain. Expect 30–80 unique candidates per pair.

### Phase 2 — ICP filter (FREE, pause for user review)

Hand-filter the pool against the user's ICP criteria:
- Employee count (use Crustdata `company_identify` — FREE — only when judgement uncertain)
- Industry vertical (back-office SaaS, commerce infra, HR-tech, etc.)
- HQ region
- Marketing maturity proxies (visible content investment)

**STOP and present the 10 finalists to the user before spending more credits.** Surface any obvious gaps or weak fits. Wait for explicit approval.

### Phase 3 — CMO finder (3 Crustdata credits, batch)

Single batch search across all 10 companies:

```ts
filters = {
  op: 'and',
  conditions: [
    { column: 'current_employers.company_website_domain', type: 'in', value: ['10 domains'] },
    { column: 'current_employers.title', type: '[.]', value: 'Marketing' },
    { column: 'current_employers.seniority_level', type: 'in', value: ['CXO', 'Vice President', 'Director'] },
  ],
}
limit: 50
```

Pick 1 marketing leader per company (prefer CMO > VP > Head > Director).

**Common gotcha**: some companies' websites are stored in Crustdata as ATS or marketing domains (e.g., `hubs.li` for Shopware), not their actual `.com`. If a company returns 0 hits, do a fallback search by `current_employers.name` substring.

**Skip people_enrich** unless the campaign needs emails (LinkedIn-only campaigns don't). Saves ~30 credits.

### Phase 4 — Multi-signal enrichment (40 PL credits for 10 finalists)

```bash
for d in domain1.com domain2.com ...; do
  npx tsx src/cli/index.ts signals:fetch --domain "$d"
done
```

Or use the bulk shortcut if leads already in a result set:

```bash
npx tsx src/cli/index.ts signals:enrich --result-set <id>
```

### Phase 5 — Hydrate templates + draft 2 variants (FREE)

Pick the single most outreach-relevant signal per company (most recent `news` > recent `financing` > recent `job_opening`). Build a `personalization_natural` line per lead that:
- **Never** says "I saw your [signal]" (per outbound rules)
- Embeds the signal as context for a category insight
- Stays ≤18 words per sentence
- Has no dashes, no `I` openers, says `Hello`, ends with a specific CTA

Draft both variants with different angles (e.g., results-led case study vs. category-shift narrative). Save the full draft to `00_Inbox/predictleads-discovery-{date}.md`.

**Do not push to Notion or activate the campaign** without explicit user approval.

## Total cost (typical)

| Phase | Credits |
|---|---|
| 1. Lookalikes (2 anchors) | 2 PL |
| 2. ICP filter | 0 |
| 3. CMO batch search | 3 Crustdata |
| 4. Multi-signal enrichment (10 companies × 4 types) | 40 PL |
| 5. Template hydration | 0 |
| **Total** | **~45 credits** (42 PL + 3 Crustdata) |

If `people_enrich` is needed: +30 Crustdata credits.

## Verification checkpoints

The pipeline pauses at:
1. **End of Phase 2** — present 10 finalists, wait for "approved"
2. **End of Phase 5** — present hydrated drafts, wait for "approved"

Never push to Notion / activate Unipile campaign without explicit user approval at the second checkpoint.

## Output artifacts

- SQLite: `company_signals` rows for the 10 finalists
- File: `00_Inbox/predictleads-discovery-{date}.md` with the 2 hydrated variants
- Optional: HTML dashboard via `predictleads-dashboard` skill

## Common pitfalls

- **Megacaps in the lookalike pool**: PredictLeads returns SAP/Microsoft/Oracle for B2B SaaS seeds. Filter manually before Phase 3.
- **Crustdata `domain` mismatch**: search by company name as fallback when domain returns 0.
- **Personalization that flag-waves**: "I saw your funding round" violates outbound rules. Reframe as category context.

## Required env

`PREDICTLEADS_API_KEY`, `PREDICTLEADS_API_TOKEN`, `CRUSTDATA_API_KEY` in `~/.gtm-os/.env`. See `TEAM_SETUP.md`.

## Related skills

- `predictleads-signals` — single-company ad-hoc
- `predictleads-lookalikes` — discovery only, no outreach
- `predictleads-dashboard` — HTML viz of enriched signals
- `unipile-campaign` — what runs the actual outreach after this skill drafts the variants
