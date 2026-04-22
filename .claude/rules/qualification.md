# Qualification Pipeline Rules

Applies to: `src/lib/qualification/`

## Context to Load
- `~/.gtm-os/qualification_rules.md` — lead qualification patterns and gate configs
- `src/lib/intelligence/store.ts` — intelligence context injection pattern
- `src/lib/qualification/` — existing gate implementations for reference

## 7-Gate Pipeline (strict order)
1. **Dedup** — deduplicate against existing leads in Unified Leads DB
2. **Headline** — basic role/title filtering
3. **Exclusion** — blocklist, competitor, and spam filtering
4. **Company** — company-level signals (size, industry, funding)
5. **Enrichment** — pull missing data via provider registry
6. **AI Score** — Claude Opus scoring with intelligence context
7. **Threshold** — final pass/fail based on configured score cutoff

## Hard Rules
1. **Gate 6 (AI Score) uses only validated intelligence.** Inject top 5 proven + top 3 validated insights from `src/lib/intelligence/store.ts`. Never inject hypotheses into scoring prompts.
2. **Output goes to the Unified Leads DB** — never write qualification results to a separate store.
3. Gates execute sequentially. A lead that fails any gate is tagged with the failure reason and skipped for remaining gates.
4. Each gate must emit structured logs: gate name, lead count in, lead count out, duration.
5. Gate configs are tenant-scoped — read from `~/.gtm-os/tenants/{slug}/qualification/`.
