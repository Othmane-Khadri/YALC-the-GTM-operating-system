# Campaign & Outbound Rules

Applies to: `src/lib/campaign/`, `src/lib/skills/builtin/track-campaign.ts`

## Context to Load
- `src/lib/outbound/rules.ts` — the 8 outbound message validation rules
- `src/lib/campaign/types.ts` — campaign and sequence type definitions
- `src/lib/campaign/sequence-engine.ts` — sequence state machine

## Hard Rules
1. **ALL outgoing messages must pass `validateMessage()`** from `src/lib/outbound/rules.ts` before send. No exceptions.
2. **Rate limits:** 30 LinkedIn connects/day via Unipile token bucket (`src/lib/rate-limiter/`).
3. **Sequence timing:** connect -> 2 days -> DM1 -> 3 days -> DM2. Configurable per campaign but these are defaults.
4. **Campaign lifecycle:** `draft -> scheduled -> active -> paused -> completed`. Only valid transitions allowed.
5. **A/B testing** uses chi-squared with Wilson-Hilferty approximation, p < 0.05. See `src/lib/campaign/significance.ts`.
6. **Never send DMs to prospects who already replied.** Check reply status before every send action.

## List-build Rules
1. **5 leads per company hard-cap** by default for any campaign list-build. Over-source 3-5×, rank, keep top 5. Ranking signals (priority order): exact title match → seniority level → tenure at company → HQ-country office → recent LinkedIn activity. Confirm with user at campaign start before sourcing if a different cap is needed.
2. **Sourcing method preference:** Crustdata `searchPeople` first (structured B2B database, 1 credit per result, current-employer guaranteed), Clay `find-and-enrich-contacts-at-company` second (multi-source, returns emails), Firecrawl Google + Unipile verify as fallback only. Align on tool at campaign start before running anything.
3. **Persona-specific filters** must be agreed up-front and saved in the campaign's source script. Examples: "global payroll only, never bare Head of Payroll" (datascalehr) — see `feedback_global_payroll_roles.md`.
4. **Pre-flight credit display + caching** — every list-build script must, on startup, print credit balances for all providers it will touch (Crustdata, Clay, Firecrawl, Unipile, etc.) and flag any below ~3× estimated burn. Every external API response must be cached on the first call into `data/scrapes/<campaign>/<provider>-cache/<key>.json`. `FORCE=1` env bypasses cache. See `feedback_credit_check_and_caching.md`.

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/campaign/creator.ts` | Campaign creation logic |
| `src/lib/campaign/tracker.ts` | Poll Unipile, advance sequences |
| `src/lib/campaign/sequence-engine.ts` | State machine for sequence steps |
| `src/lib/campaign/significance.ts` | A/B test statistical significance |
| `src/lib/campaign/intelligence-report.ts` | Weekly campaign intelligence |
| `src/lib/campaign/optimizer.ts` | Auto-optimization based on signals |
