# Enrichment & Provider Rules

Applies to: `src/lib/enrichment/`, `src/lib/providers/`, `configs/mcp/`

## Context to Load
- `~/.gtm-os/framework.yaml` — company context and ICP definition
- `docs/providers.md` — provider setup and capabilities reference
- `src/lib/providers/types.ts` — the StepExecutor interface all providers implement

## Enrichment Recipes
- `docs/enrichment/country-footprint-recipe.md` — verified Firecrawl + LLM-validation + LinkedIn-fallback cascade for "how many countries does Company X operate in." Use this whenever an ICP filter gates on multi-country presence. Do NOT use LLM prior knowledge for the count itself.

## People Sourcing Method
For sourcing named individuals at target companies, use this priority order (do NOT default to Firecrawl Google scraping):
1. **Crustdata `searchPeople`** (`src/lib/services/crustdata.ts`) — structured filter by `companyNames` + `titles` + `seniorityLevels` + `location`. Current-employer guaranteed. 1 credit per result.
2. **Clay `find-and-enrich-contacts-at-company`** (MCP) — multi-source, returns LinkedIn-verified contacts + emails. Use for enrichment / email backfill on the final shortlist.
3. **Firecrawl Google + Unipile verify** (the C8 pattern in `scripts/c8-source-tier1-and-alliances.ts`) — fallback only. Use when Crustdata + Clay come up short for niche titles.

Align on the chosen tool at campaign start. The C8 pattern was Firecrawl-first because we hadn't audited alternatives — that's not a precedent to copy.

## Hard Rules
1. **All enrichment goes through the provider registry** (`src/lib/providers/registry.ts`). Never call external APIs directly.
2. **Credit tracking is mandatory** for every provider call. Check `src/lib/providers/stats.ts` for the tracking pattern.
3. **MCP providers** load from `~/.gtm-os/mcp/*.json` — see MCP loader in `src/lib/providers/` for the dynamic loading pattern.
4. Provider errors must be caught and returned as structured `ProviderError` objects, never thrown as raw exceptions.
5. New providers must register in `src/lib/providers/builtin/index.ts` and export from the barrel.

## Provider Implementation Checklist
- [ ] Implements `StepExecutor` from `src/lib/providers/types.ts`
- [ ] Registered in provider registry
- [ ] Credit cost documented in provider metadata
- [ ] Rate limiting configured (see `src/lib/rate-limiter/`)
- [ ] Error handling returns `ProviderError` with actionable messages
