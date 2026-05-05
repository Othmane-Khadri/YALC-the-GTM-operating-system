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
6. **All external HTTP calls must go through `cachedFetch`** from `src/lib/cache/cached-fetch.ts`. SDK-mediated calls (Unipile SDK, Notion SDK, MCP) wrap the inner call with `withCache({ scope, key }, fn)` from the same module. This is non-negotiable: it preserves partial results when a script crashes mid-build or runs out of credits, and it dedupes identical calls across campaigns. Adding a new provider means adopting the same convention — never roll a per-provider cache.

### Cache mechanics
- Cache root: `~/.gtm-os/_cache/<scope>/<sha256>.json`. Override via `YALC_CACHE_DIR`.
- Scope defaults to URL hostname; pass an explicit `scope` for SDK-mediated calls.
- TTL is OFF by default (cache forever) — this is a credit-saving cache, not a freshness cache. Pass `ttlMs` for endpoints whose data goes stale.
- Bypass for one call: `cachedFetch(url, init, { bypass: true })` or `withCache({ ..., ttlMs: 0 })`.
- Force-bypass everything in a process: `FORCE=1 npx tsx ...`.
- Only 2xx responses are cached. 4xx/5xx always go live.

## Provider Implementation Checklist
- [ ] Implements `StepExecutor` from `src/lib/providers/types.ts`
- [ ] Registered in provider registry
- [ ] Credit cost documented in provider metadata
- [ ] Rate limiting configured (see `src/lib/rate-limiter/`)
- [ ] Error handling returns `ProviderError` with actionable messages
- [ ] All external calls use `cachedFetch` / `withCache` from `src/lib/cache/cached-fetch.ts`
