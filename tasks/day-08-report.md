# Day 08 Report — Apify MCP Bridge + Real Qualification Engine

**Date:** 2026-03-10
**Build status:** Clean (zero TS errors)
**Commits:** 3 (see below)

---

## What was built

### Part A: Apify MCP Server Integration
Connected GTM-OS to Apify's MCP server for dynamic actor discovery. Instead of only the 8 hardcoded catalog entries, the system can now discover and register any Apify actor at runtime.

**New file: `src/lib/mcp/apify-auto-connect.ts`**
- Lazy auto-connect: first workflow execution or planner invocation triggers MCP server connection
- Uses stdio transport: `npx @apify/actors-mcp-server --tools actors`
- Passes `APIFY_TOKEN` via env vars (encrypted in MCP manager)
- No-ops if token isn't set or already connected
- Discovered tools auto-register as StepExecutors via existing MCP bridge

**Wired into:**
- `execute/route.ts` — `ensureApifyMcp()` called before step loop
- `chat/route.ts` — called before building planner system prompt, so discovered actors appear in provider list

**Architectural decision:** Static `APIFY_CATALOG` stays for the 8 core actors (custom `buildInput`/`normalizeRow`). MCP actors are additive — they fill gaps (Instagram, TikTok, e-commerce, review scrapers, etc.). The MCP bridge's shadowing prevention ensures catalog entries aren't overridden.

### Part B: Real Qualification Engine (Feature 1)

**Row piping between steps:**
- Added `previousStepRows` accumulator in execution loop
- After each search/enrich step, rows are collected from DB and passed to the next step's `ExecutionContext`
- Qualify step receives actual upstream data — no more mock leads

**QualifyProvider (`src/lib/providers/builtin/qualify-provider.ts`):**
- Dedicated provider for `qualify` step type (replaces MockProvider for qualification)
- Uses Claude tool use (`score_leads`) against the user's ICP framework
- Produces 4 fields per row: `icp_score` (0-100), `icp_fit_level` (Strong/Moderate/Poor), `qualification_reason`, `qualification_signals`
- Batches scoring (10 rows per API call)
- Empty upstream = empty batch (no crash)

**Learning injection:**
- Framework learnings (`validated`/`proven` confidence) are fetched and injected into the qualify prompt
- Last 10 learnings included as bullet points
- Patterns from RLHF feedback loop now influence scoring

**In-place row updates:**
- Qualify step updates existing rows instead of inserting duplicates
- Result set columns are dynamically merged (qualify columns appended)
- New `columns_updated` SSE event notifies the frontend

### Part C: Apify E2E + Cost Tracking (Feature 2)

**Test route (`src/app/api/test/apify/route.ts`):**
- Developer-only POST endpoint
- Tests full chain: provider resolution → health check → execution → intelligence recording → auto-selection
- Calls `ensureApifyMcp()` first for MCP-discovered providers

**Cost tracking:**
- Added `costPer1k` to `ApifyActorEntry` interface and all 8 catalog entries
- Execution loop computes `estimatedCost = (stepRowCount / 1000) * costPer1k`
- Cost written to `workflowSteps.costEstimate` and `providerIntelligence.recordExecution()`
- MCP providers without catalog entry default to 0

---

## Files changed

| File | Change |
|------|--------|
| `src/lib/providers/types.ts` | Added `learningsContext`, `previousStepRows` to `ExecutionContext` |
| `src/lib/ai/types.ts` | Added `columns_updated` to `ExecutionEventType` |
| `src/lib/execution/columns.ts` | Expanded `QUALIFY_COLUMNS` (2 → 4 fields) |
| `src/lib/providers/builtin/qualify-provider.ts` | **New** — QualifyProvider class |
| `src/lib/providers/builtin/apify-catalog.ts` | Added `costPer1k` to interface + all 8 entries |
| `src/lib/providers/registry.ts` | Registered QualifyProvider |
| `src/lib/ai/workflow-planner.ts` | Updated qualify step description in planner prompt |
| `src/lib/mcp/apify-auto-connect.ts` | **New** — Lazy Apify MCP server connection |
| `src/app/api/workflows/execute/route.ts` | Row piping, qualify handling, learnings, cost tracking, MCP auto-connect |
| `src/app/api/chat/route.ts` | Wired `ensureApifyMcp()` before planner prompt |
| `src/app/api/test/apify/route.ts` | **New** — Apify E2E test endpoint |
| `package.json` | Added `@apify/actors-mcp-server` dependency |

## Decisions

1. **Static catalog stays alongside MCP.** The 8 catalog entries have custom `buildInput`/`normalizeRow` functions that produce cleaner output than generic MCP normalization. MCP fills gaps only.

2. **stdio transport over SSE.** Apify is deprecating SSE on April 1, 2026. Their MCP server also supports Streamable HTTP, but GTM-OS's MCP manager only supports stdio and SSE. stdio is reliable for local dev.

3. **Qualify updates rows in-place.** Instead of inserting duplicate rows, qualify merges scores into existing rows. This keeps the result table clean and avoids row count inflation.

4. **Learning injection is last-10-only.** To keep prompt sizes manageable, only the 10 most recent validated/proven learnings are included.

## Flags

- **QUALIFIER_MODEL is claude-opus-4-6** — this is the most expensive model. For production cost optimization, consider switching to claude-sonnet-4-6 for qualification (lower cost, still good at structured scoring).
- **Apify MCP server startup time** — first `npx @apify/actors-mcp-server` call may take 5-10s for npm resolution. Subsequent calls are faster (cached). Consider pre-connecting on app startup instead of lazy init.
- **Streamable HTTP transport** — when GTM-OS adds StreamableHTTPClientTransport support, the Apify MCP server can connect remotely at `https://mcp.apify.com` instead of running locally via stdio.
