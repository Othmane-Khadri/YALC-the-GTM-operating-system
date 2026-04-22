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

## Key Files
| File | Purpose |
|------|---------|
| `src/lib/campaign/creator.ts` | Campaign creation logic |
| `src/lib/campaign/tracker.ts` | Poll Unipile, advance sequences |
| `src/lib/campaign/sequence-engine.ts` | State machine for sequence steps |
| `src/lib/campaign/significance.ts` | A/B test statistical significance |
| `src/lib/campaign/intelligence-report.ts` | Weekly campaign intelligence |
| `src/lib/campaign/optimizer.ts` | Auto-optimization based on signals |
