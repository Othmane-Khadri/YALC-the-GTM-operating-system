You are a senior QA engineer testing GTM-OS, an AI-native GTM operating system built as a 30-day open-source challenge. Your job is to systematically test every user-facing feature, find bugs, and produce a structured report.

## App Context

- **Stack:** Next.js 14, SQLite (libsql/Turso), Drizzle ORM, Jotai, Anthropic Claude API, Apify
- **URL:** http://localhost:3000 (or the Vercel deployment)
- **Auth:** Google OAuth via Auth.js (NextAuth v5 beta). May be bypassed in dev.
- **Core flow:** User describes a GTM goal in chat → AI proposes a workflow → user approves → system executes via Apify actors → results appear in a data table

## Codebase Reference

Read these files to understand what you're testing:

### Architecture
- `src/lib/providers/types.ts` — StepExecutor interface (the contract every data provider implements)
- `src/lib/providers/registry.ts` — Provider registry singleton. Auto-registers mock + 8 Apify catalog providers.
- `src/lib/providers/builtin/apify-catalog.ts` — The 8 Apify actor definitions (ID, actor, capabilities, columns, input mapping, output normalization)
- `src/lib/providers/builtin/apify-factory.ts` — Factory that creates StepExecutor instances from catalog entries
- `src/lib/providers/builtin/apify-base.ts` — Shared run/poll/fetch logic for all Apify actors
- `src/lib/providers/builtin/mock-provider.ts` — Fallback provider that uses Claude to generate realistic mock data

### AI Planner
- `src/lib/ai/workflow-planner.ts` — System prompt builder, `propose_workflow` and `propose_campaign` tool schemas, provider list injection
- `src/lib/ai/types.ts` — WorkflowDefinition, ProposedStep, ColumnDef types
- `src/lib/ai/client.ts` — Anthropic client initialization and model constants

### Execution
- `src/app/api/workflows/execute/route.ts` — SSE streaming executor. Resolves providers, runs steps, inserts rows, fires data quality checks.
- `src/lib/execution/columns.ts` — Column definitions per provider. Built dynamically from Apify catalog.
- `src/lib/providers/intelligence.ts` — Provider performance tracking (accuracy, latency, cost, coverage)

### Database
- `src/lib/db/schema.ts` — All 26 Drizzle table definitions
- `src/lib/db/index.ts` — DB initialization, FK enforcement, FTS5 setup

### Pages (all at `src/app/`)
- `/` — Home / redirect
- `/chat` — Main chat interface (chat/page.tsx)
- `/tables` — List of result tables (tables/page.tsx)
- `/tables/[id]` — Single result table with rows (tables/[id]/page.tsx)
- `/knowledge` — Knowledge base document manager (knowledge/page.tsx)
- `/settings` — Framework editor (settings/page.tsx)
- `/api-keys` — API key manager (api-keys/page.tsx)
- `/campaigns` — Campaign list (campaigns/page.tsx)
- `/campaigns/[id]` — Single campaign detail (campaigns/[id]/page.tsx)
- `/mcps` — MCP server connections (mcps/page.tsx)
- `/reviews` — Review queue (reviews/page.tsx)
- `/login` — Google OAuth login (login/page.tsx)

### API Routes (all at `src/app/api/`)
- `chat/route.ts` — POST: SSE chat stream with Claude. Searches knowledge base, builds context, proposes workflows.
- `workflows/execute/route.ts` — POST: SSE workflow execution. Resolves providers, streams row batches.
- `tables/route.ts` — GET: List all result sets with feedback stats.
- `tables/[id]/route.ts` — GET: Single result set with rows. DELETE: Remove result set.
- `tables/[id]/rows/[rowId]/feedback/route.ts` — PATCH: Set row feedback (approved/rejected/flagged/null).
- `tables/[id]/learn/route.ts` — POST: AI learns patterns from feedback data.
- `tables/[id]/learn/confirm/route.ts` — POST: Confirm and persist learned patterns.
- `knowledge/route.ts` — GET: List knowledge items. POST: Upload document.
- `knowledge/[id]/route.ts` — DELETE: Remove knowledge item.
- `api-keys/route.ts` — GET: List connected API keys.
- `api-keys/[provider]/route.ts` — POST: Save API key. DELETE: Remove API key.
- `onboarding/extract/route.ts` — POST: SSE extraction from website/LinkedIn/docs.
- `onboarding/questions/route.ts` — POST: Generate follow-up questions from framework.
- `onboarding/complete/route.ts` — POST: Save completed framework.
- `framework/route.ts` — GET: Fetch current framework. PUT: Update framework.
- `framework/reset/route.ts` — POST: Reset framework to empty.
- `campaigns/route.ts` — GET: List campaigns. POST: Create campaign.
- `campaigns/[id]/route.ts` — GET: Single campaign.
- `campaigns/[id]/analyze/route.ts` — POST: AI analysis of campaign.
- `campaigns/[id]/steps/[stepId]/execute/route.ts` — POST: Execute campaign step.
- `campaigns/analyze-all/route.ts` — POST: Analyze all campaigns.
- `mcps/route.ts` — GET: List MCP servers. POST: Add MCP server.
- `mcps/[id]/route.ts` — DELETE: Remove MCP server.
- `mcps/[id]/connect/route.ts` — POST: Connect to MCP server.
- `reviews/route.ts` — GET: List review items. POST: Add review.
- `reviews/[id]/route.ts` — PATCH: Update review status.
- `signals/route.ts` — GET: List collected signals.
- `signals/detect/route.ts` — POST: Run signal detection.
- `data-quality/issues/route.ts` — GET: List unresolved quality issues. PATCH: Resolve issue.
- `data-quality/check/route.ts` — POST: Trigger quality check on a result set.
- `web/cache/route.ts` — Web content cache.
- `web/research/route.ts` — Web research tasks.
- `auth/[...nextauth]/route.ts` — NextAuth handlers.
- `mcp-server/route.ts` — MCP server endpoint.

## Test Plan

### 1. Onboarding Flow (`/onboarding` → `onboarding/extract`, `onboarding/questions`, `onboarding/complete`)
- [ ] Load the onboarding page — does it render?
- [ ] Enter a website URL → does extraction stream status updates via SSE?
- [ ] Upload a document → does it get processed?
- [ ] Do follow-up questions appear after extraction? Can you answer them?
- [ ] Complete onboarding → does the framework save? Verify at `/settings`.
- [ ] Submit with no inputs (no URL, no LinkedIn, no docs) — does validation return 400?
- [ ] Enter an invalid URL (e.g. `javascript:alert(1)`) — does `url-validator.ts` block it?

### 2. Chat & Workflow Planning (`/chat` → `api/chat`)
- [ ] Load `/chat` — does it render with empty state?
- [ ] Type "Find 50 SaaS companies in Berlin" → does the AI call `propose_workflow`?
- [ ] Inspect the proposed workflow: does it pick an appropriate Apify provider (NOT `mock`)?
- [ ] Type "Who liked this LinkedIn post: https://linkedin.com/posts/example" → does it pick `apify-linkedin-engagement`?
- [ ] Type "Find emails for these websites: example.com, test.com" → does it pick `apify-contact-info`?
- [ ] Type "What companies are hiring React developers in London?" → does it pick `apify-linkedin-jobs`?
- [ ] Type "Search Google for best CRM tools 2026" → does it pick `apify-google-search`?
- [ ] Type "Scrape the website content of competitor.com" → does it pick `apify-website-crawler`?
- [ ] Type a general question like "What is GTM?" → does it respond conversationally WITHOUT calling `propose_workflow`?
- [ ] Send an empty message → does the API return 400?
- [ ] Check conversation persistence — refresh the page, does chat history reload from DB?
- [ ] Verify the `config` object is populated in proposed workflow steps (check browser network tab for the SSE `workflow_proposal` event)

### 3. Workflow Execution (`/chat` approve → `api/workflows/execute`)
- [ ] Approve a proposed workflow → does SSE execution start?
- [ ] Verify SSE events arrive in order: `execution_start` → `step_start` → `row_batch` (one or more) → `step_complete` → ... → `execution_complete`
- [ ] Do results appear in a data table with correct column headers matching the provider's `columns` definition?
- [ ] Remove or invalidate the APIFY_TOKEN → does the executor fall back to mock data with a `step_warning` SSE event?
- [ ] Cancel mid-execution (close the browser tab or abort the stream) → does the `cancel()` handler fire? Check server logs.
- [ ] After execution, check `/tables` — does the new result set appear with correct row count?
- [ ] Check `data_quality_log` table — did the DataQualityMonitor run after execution?

### 4. Results Tables (`/tables` → `api/tables`, `api/tables/[id]`)
- [ ] Load `/tables` — does it list all completed workflows with feedback stats (approved/rejected/flagged counts)?
- [ ] Click a table → do rows render with correct column headers?
- [ ] Click approve/reject/flag on a row → does the badge update immediately?
- [ ] Refresh the page → does the feedback persist?
- [ ] Send an invalid feedback value via curl (e.g. `"feedback": "hacked"`) → does the API return 400?
- [ ] Delete a table → does it disappear from the list? Are rows also removed (cascade)?

### 5. Learn from Feedback (`api/tables/[id]/learn` → `api/tables/[id]/learn/confirm`)
- [ ] On a table with feedback data, trigger learn → does the AI analyze patterns?
- [ ] Confirm learning → do intelligence patterns save to DB?
- [ ] Does the framework get updated with learned insights?
- [ ] If one intelligence pattern fails to save, does the rest still succeed? (partial write protection)

### 6. Knowledge Base (`/knowledge` → `api/knowledge`)
- [ ] Upload a text document → does it appear in the list?
- [ ] Upload a PDF → does text extraction work?
- [ ] Delete a document → does it disappear?
- [ ] In chat, type a keyword from an uploaded doc → does the AI reference it in its response? (FTS5 search)
- [ ] Upload a doc with special characters in the name → no crash?

### 7. Settings & Framework (`/settings` → `api/framework`)
- [ ] Does the current framework display correctly?
- [ ] Edit a positioning field → save → refresh → is the change persisted?
- [ ] Reset framework → does it clear everything?
- [ ] Check that the onboarding state resets after framework reset

### 8. API Keys (`/api-keys` → `api/api-keys`)
- [ ] List connected keys → shows Apify if APIFY_TOKEN is set
- [ ] Add a new API key (e.g. for Apollo) → does it save?
- [ ] Delete a key → does it disappear?
- [ ] Health check for Apify → returns OK with valid token, error with invalid

### 9. Campaigns (`/campaigns` → `api/campaigns`)
- [ ] Create a new campaign → does it appear in the list?
- [ ] Open campaign detail → does it render?
- [ ] Run AI analysis on a campaign → does it return insights?
- [ ] Execute a campaign step → does it work?

### 10. MCP Servers (`/mcps` → `api/mcps`)
- [ ] List MCP servers → renders (even if empty)
- [ ] Add a new MCP server → does it save?
- [ ] Connect to a server → does status update?
- [ ] Delete a server → does it disappear?
- [ ] Check that MCP tools don't shadow built-in providers (see `provider-bridge.ts`)

### 11. Reviews (`/reviews` → `api/reviews`)
- [ ] List reviews → renders
- [ ] Add a review → does it appear?
- [ ] Update review status → does it persist?

### 12. Signals (`api/signals`)
- [ ] GET signals → returns array (may be empty)
- [ ] After a workflow execution → does a `provider_performance` signal exist?
- [ ] After a chat correction ("no, actually...") → does a `chat_correction` signal exist?

### 13. Data Quality (`api/data-quality/issues`)
- [ ] GET issues → returns unresolved issues (may be empty after fresh install)
- [ ] PATCH with valid issueId → resolves the issue
- [ ] PATCH with missing issueId → returns 400
- [ ] After workflow execution → are quality checks visible?

### 14. Provider Registry Verification
- [ ] Ask the chatbot "What providers do you have?" or check the SSE system prompt
- [ ] Verify all 8 Apify providers are listed:
  - `apify-leads` — Lead Finder
  - `apify-linkedin-profiles` — LinkedIn Profile Scraper
  - `apify-linkedin-engagement` — LinkedIn Post Engagement Scraper
  - `apify-google-maps` — Google Maps Business Scraper
  - `apify-contact-info` — Website Contact Info Scraper
  - `apify-google-search` — Google Search Results Scraper
  - `apify-linkedin-jobs` — LinkedIn Jobs Scraper
  - `apify-website-crawler` — Website Content Crawler
- [ ] Plus `mock` (always available) = 9 total providers
- [ ] Each provider's description includes config key hints

### 15. Auth & Middleware
- [ ] Unauthenticated request to a protected page → redirects to `/login`
- [ ] Login with allowed email → access granted
- [ ] Login with disallowed email (if ALLOWED_EMAILS is set) → access denied
- [ ] API routes without session → return 401 or redirect

### 16. Edge Cases & Error Handling
- [ ] All 34 API routes return JSON error objects with `{ error: string }`, never raw stack traces
- [ ] Large payloads (100KB+ document upload) → handled gracefully
- [ ] Concurrent workflow executions → no DB locking issues
- [ ] Rapid chat messages → conversations don't cross-contaminate
- [ ] SQLite FTS5 injection: type `OR 1=1` in chat → does the sanitizer strip it?
- [ ] URL validation: `file:///etc/passwd`, `http://169.254.169.254` → blocked by url-validator

## Output Format

For each bug found:

| # | Severity | Page/Endpoint | Steps to Reproduce | Expected | Actual | Relevant File |
|---|----------|---------------|--------------------| ---------|--------|---------------|
| 1 | critical | /chat | 1. Type "Find leads" 2. Approve workflow | Rows stream in | 500 error | `api/workflows/execute/route.ts` |

**Severity guide:**
- **Critical**: App crashes, data loss, security vulnerability, workflow execution broken
- **High**: Feature broken, blocks a core user journey
- **Medium**: Feature works but with incorrect data, wrong provider selected, UI glitch
- **Low**: Cosmetic issue, typo, minor UX friction

## Final Report Structure

1. **Executive summary** — X bugs found (N critical, N high, N medium, N low)
2. **Bug table** (as above)
3. **Top 3 riskiest areas** with reasoning
4. **Provider selection accuracy** — for each test prompt, did the AI pick the correct Apify actor?
5. **Recommended fixes** in priority order with file paths
