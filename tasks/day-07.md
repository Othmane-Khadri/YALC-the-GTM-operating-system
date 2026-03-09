# Day 7 — Smart Provider Selection + Pipeline Fixes + Docs Cleanup

**Date:** 2026-03-09
**Goal:** One clean demo loop — chat → propose → approve → execute → table with data

---

## What You're Building

1. **Smart provider selection** — the registry now only shows Claude providers whose credentials exist. Apify appears when APIFY_TOKEN is set; otherwise Claude only sees Mock. Graceful fallback if any provider crashes mid-run.
2. **Pipeline fixes** — workflow planner tool description, filter/export step passthrough, knowledge context wiring, Apify vault fallback.
3. **Design docs cleanup** — `docs/BRAND.md` and `CLAUDE.md` still reference the old Clay design (Space Mono, blueberry/matcha). No CSS changes needed.

---

## Read First

1. `src/lib/ai/workflow-planner.ts` — line 38, broken provider examples
2. `src/lib/providers/types.ts` — ExecutionContext + StepExecutor interfaces
3. `src/lib/providers/registry.ts` — getAvailableForPlanner() needs filtering
4. `src/app/api/workflows/execute/route.ts` — execution loop, filter/export gap
5. `src/lib/providers/builtin/apify-leads-provider.ts` — env-only token read
6. `src/lib/providers/builtin/mock-provider.ts` — missing knowledgeContext forwarding
7. `src/components/chat/WorkflowPreviewCard.tsx` — PROVIDER_COLORS map
8. `src/components/layout/Sidebar.tsx` — day counter

---

## Requirements

### Fix 1: workflow-planner.ts provider description
Change line 38 `provider.description` from legacy examples to:
`"Data provider ID from the registry. Use the exact ID from Available Providers in the system prompt. Never use names not listed there."`

### Fix 2: Credential-aware registry
- Add `isAvailable(): boolean` to `StepExecutor` interface (default `true`)
- Apify providers override: check `process.env.APIFY_TOKEN`
- `getAvailableForPlanner()` filters by `isAvailable()`

### Fix 3: Graceful fallback in execute route
Wrap `executor.execute()` in try/catch. On error → resolve MockProvider → re-execute → emit SSE warning.

### Fix 4: Filter/export passthrough
Add SSE notes for filter/export steps. Preserve totalSoFar.

### Fix 5: Apify vault fallback
Shared `getApifyToken()`: env → apiConnections table + decrypt() → throw.

### Fix 6: Wire knowledgeContext
- Add `knowledgeContext?: string` to `ExecutionContext`
- Query knowledgeItems in execute route, pass through
- Forward in mock-provider.ts

### Fix 7: README build log
Move Day 6 Apify content to Day 6 section. Write Day 7 entry.

### Fix 8: Sidebar counter
"Day 5 of 30" → "Day 7 of 30"

### Fix 9: PROVIDER_COLORS
Add `mock`, `apify-leads`, `apify-linkedin-engagement` to color map.

### Docs: BRAND.md + CLAUDE.md
Rewrite BRAND.md with actual Kiln tokens. Update CLAUDE.md stale sections (fonts, colors, provider list, table count).

---

## Process

1. Read all files listed above
2. Implement fixes (types.ts first since it's shared)
3. `pnpm build` — must pass
4. Write `tasks/day-07-report.md`
5. Commit: atomic per fix group

## Commit Convention

```
fix: smart provider selection — credential-aware registry + graceful fallback (Day 07)
fix: pipeline — filter passthrough, vault fallback, knowledge context wiring (Day 07)
fix: provider colors + day counter (Day 07)
chore: rewrite brand docs + CLAUDE.md + readme build log (Day 07)
```
