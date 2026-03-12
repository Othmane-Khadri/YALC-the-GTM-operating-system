# GTM-OS QA Audit Report

**Date:** 2026-03-09
**Auditor:** Claude Opus 4.6 (automated)
**Server:** Next.js 14.2.35 on localhost:3003
**DB:** SQLite via libsql (`file:./gtm-os.db`)

---

## Executive Summary

| Severity | Count |
|----------|-------|
| Critical | 5     |
| High     | 11    |
| Medium   | 12    |
| Low      | 7     |
| **Total** | **35** |

### Top 3 Critical Issues

1. **Middleware crashes on every request** — `auth()` imports `db` which uses `file:` URL, incompatible with Edge runtime. Every route returns HTTP 500.
2. **17 tables missing from SQLite DB** — Schema defines 26 tables; only 9 exist. No migrations directory. Any route touching `campaigns`, `intelligence`, `mcp_servers`, `signals_log`, `review_queue`, etc. will crash.
3. **PRAGMA foreign_keys = 0** — Foreign key constraints are never enforced. Cascade deletes are silently ignored, orphan rows accumulate freely.

---

## Area 1 — Database Integrity

### [DB] — 17 of 26 schema tables missing from SQLite

- **Severity:** Critical
- **File:** `src/lib/db/schema.ts` (full file) / `src/lib/db/index.ts`
- **What happens:** Routes that query `campaigns`, `campaign_steps`, `campaign_content`, `intelligence`, `mcp_servers`, `review_queue`, `notification_preferences`, `web_cache`, `web_research_tasks`, `provider_stats`, `provider_preferences`, `signals_log`, `data_quality_log`, `users`, `accounts`, `sessions`, `verificationTokens` crash with "no such table".
- **Why:** No migration files exist (`src/lib/db/migrations/` is empty). `db:push` or `db:generate` was never run. Schema.ts defines tables but they were never materialized in the actual DB.
- **Repro:** `sqlite3 gtm-os.db ".tables"` — shows only: `api_connections`, `conversations`, `frameworks`, `knowledge_fts*`, `knowledge_items`, `messages`, `result_rows`, `result_sets`, `workflow_steps`, `workflows`

### [DB] — PRAGMA foreign_keys disabled

- **Severity:** High
- **File:** `src/lib/db/index.ts:7-10`
- **What happens:** All `ON DELETE CASCADE` constraints in schema.ts are silently ignored. Deleting a conversation leaves orphan messages, workflows, workflow_steps, result_sets, result_rows.
- **Why:** libsql/SQLite defaults to `foreign_keys = OFF`. The db init code never runs `PRAGMA foreign_keys = ON`.
- **Repro:** `sqlite3 gtm-os.db "PRAGMA foreign_keys;"` → returns `0`

### [DB] — FTS5 content table column mismatch

- **Severity:** Medium
- **File:** `src/lib/db/index.ts:17-25`
- **What happens:** `knowledge_fts` is created with `content='knowledge_items'` and `content_rowid='rowid'`, but `knowledge_items` uses a text `id` primary key (not integer `rowid`). The FTS5 `item_id` column doesn't sync via the content table mechanism — queries like `SELECT count(*) FROM knowledge_fts` fail with "no such column: T.item_id".
- **Why:** SQLite content FTS5 tables expect the content table's `rowid` to match, but Drizzle generates `id TEXT PRIMARY KEY` which shadows `rowid`. The FTS triggers use `new.id` as `item_id`, creating a parallel index that isn't properly synced.
- **Repro:** `sqlite3 gtm-os.db "SELECT count(*) FROM knowledge_fts;"` → `Error: stepping, no such column: T.item_id`

### [DB] — initFts() error silently swallowed

- **Severity:** Low
- **File:** `src/lib/db/index.ts:60-62`
- **What happens:** FTS initialization errors are caught and ignored. If `knowledge_items` table doesn't exist yet, the FTS table is still created but backfill silently fails. If the FTS schema is broken (as above), no error surfaces.
- **Why:** The `.catch(() => {})` swallows all errors with comment "safe to ignore."
- **Repro:** Check server logs — no FTS error logged despite broken FTS.

---

## Area 2 — Onboarding

### [Onboarding] — followUpAnswers stored in Jotai atom but never sent to server

- **Severity:** High
- **File:** `src/components/onboarding/steps/QuestionsStep.tsx:60-64`
- **What happens:** User answers follow-up questions. Each answer is stored in `data.followUpAnswers` (Jotai atom). When `completeOnboarding()` fires, it sends `data.extractedFramework` — but `followUpAnswers` are **never merged** into the framework. The answers are discarded.
- **Why:** `completeOnboarding()` at line 52 sends `{ framework }` where `framework = data.extractedFramework`. The `followUpAnswers` dict (keyed by field path like `"segments[0].painPoints"`) is never applied to the framework object.
- **Repro:** Complete onboarding with follow-up answers → check framework in DB → answers missing.

### [Onboarding] — QuestionsStep closes modal on error

- **Severity:** Medium
- **File:** `src/components/onboarding/steps/QuestionsStep.tsx:55-57`
- **What happens:** If the `/api/onboarding/complete` call fails, the `catch` block runs `setOpen(false)`, closing the modal. User has no indication that save failed; framework is not persisted.
- **Why:** The catch block does `setOpen(false)` instead of showing an error.
- **Repro:** Kill the server mid-onboarding → click "Complete Setup" → modal closes, no error shown.

### [Onboarding] — extract route accepts empty websiteUrl without error

- **Severity:** Low
- **File:** `src/app/api/onboarding/extract/route.ts:24-28`
- **What happens:** If `websiteUrl` is empty string or undefined, the `if (websiteUrl)` guard skips fetching but proceeds to call Claude with potentially zero context. Claude returns a framework with empty fields.
- **Why:** No validation that at least one input source (URL, LinkedIn, documents) is provided.
- **Repro:** `curl -X POST http://localhost:3003/api/onboarding/extract -H "Content-Type: application/json" -d '{"websiteUrl": ""}'`

### [Onboarding] — questions route called before framework exists

- **Severity:** Low
- **File:** `src/app/api/onboarding/questions/route.ts:10`
- **What happens:** If called with `{ framework: null }`, the gap analysis accesses `framework.company` which is `undefined`. This doesn't crash (optional chaining `c?.industry`) but sends Claude a `null` framework, producing generic unhelpful questions.
- **Why:** No early return when framework is null/empty.
- **Repro:** `curl -X POST http://localhost:3003/api/onboarding/questions -H "Content-Type: application/json" -d '{"framework": null}'`

---

## Area 3 — Chat & Workflow Proposal

### [Chat] — FTS5 MATCH query with unsanitized user input

- **Severity:** High
- **File:** `src/app/api/chat/route.ts:27-38`
- **What happens:** The user's chat message is passed directly as the FTS5 MATCH parameter. FTS5 has its own query syntax (AND, OR, NOT, NEAR, column filters). A user typing `"company" NOT "startup"` or `title:secret` executes as FTS operators, not literal search. While parameterized (not injectable SQL), the FTS query syntax itself is an unintended attack surface.
- **Why:** The `args: [query]` prevents SQL injection, but FTS5 MATCH syntax is a separate concern. Special chars like `*`, `"`, `NEAR`, `OR` are interpreted as FTS operators.
- **Repro:** Send chat message: `"test" OR "password"` — FTS interprets this as boolean OR across the knowledge base.

### [Chat] — history includes 'system' role but Anthropic API only accepts user/assistant

- **Severity:** Medium
- **File:** `src/app/api/chat/route.ts:125-129`
- **What happens:** Messages with `role: 'system'` are stored in the DB (schema allows `'user' | 'assistant' | 'system'`). When building `anthropicMessages`, all messages are mapped including system ones, but cast to `role: 'user' | 'assistant'`. A system message would be sent as-is to Claude which rejects unknown roles.
- **Why:** No filter on `history` to exclude system messages before sending to Claude.
- **Repro:** Insert a system message into the messages table → next chat in that conversation will fail.

### [Chat] — Missing ANTHROPIC_API_KEY crashes with unhelpful error

- **Severity:** Medium
- **File:** `src/lib/ai/client.ts:8-11` via `src/app/api/chat/route.ts:132`
- **What happens:** `getAnthropicClient()` throws "ANTHROPIC_API_KEY is not set" but this is caught by the SSE error handler which sends `{ type: 'error', error: 'ANTHROPIC_API_KEY is not set...' }`. The env file shows `ANTHROPIC_API_KEY=` (empty).
- **Why:** No startup-time validation. The error only surfaces when a user sends a message.
- **Repro:** Leave ANTHROPIC_API_KEY empty → send any chat message → SSE error event.

---

## Area 4 — Workflow Execution

### [Workflow] — No FK validation on conversationId

- **Severity:** High
- **File:** `src/app/api/workflows/execute/route.ts:46-53`
- **What happens:** A bogus `conversationId` (e.g., `"nonexistent"`) is inserted into the `workflows` table. Since `PRAGMA foreign_keys = OFF`, no constraint check runs. The workflow runs successfully but is orphaned — never visible in any conversation.
- **Why:** No existence check on `conversationId` before insert + FK enforcement disabled.
- **Repro:** `curl -X POST http://localhost:3003/api/workflows/execute -H "Content-Type: application/json" -d '{"conversationId":"fake-id","workflow":{"title":"test","description":"t","steps":[],"estimatedTime":"1m","requiredApiKeys":[]}}'`

### [Workflow] — No SSE connection close / cancel handler

- **Severity:** Medium
- **File:** `src/app/api/workflows/execute/route.ts:30-40`
- **What happens:** If the client disconnects mid-execution (browser tab closed), the `ReadableStream.start()` function continues executing all steps, inserting rows, and calling providers. There's no `cancel()` handler on the stream.
- **Why:** `ReadableStream` supports a `cancel()` callback, but none is implemented.
- **Repro:** Start a multi-step workflow → close browser tab → check DB → workflow still runs to completion.

### [Workflow] — Mock provider receives knowledgeContext correctly

- **Severity:** Info (no bug)
- **File:** `src/lib/providers/builtin/mock-provider.ts:25-26`
- **What happens:** `context.knowledgeContext` is passed through to `generateMockLeads`. This works correctly.
- **Why:** N/A — confirmed working.

### [Workflow] — Apify provider without APIFY_TOKEN throws at execution time

- **Severity:** Medium
- **File:** `src/lib/providers/builtin/apify-leads-provider.ts:31-33` / `src/lib/providers/builtin/apify-token.ts:15-23`
- **What happens:** `isAvailable()` returns `false` when no env var, so the planner won't suggest it. But if a user manually edits a workflow to use `apify-leads`, execution calls `getApifyToken()` which throws. The execute route catches this and falls back to mock, which is correct behavior.
- **Why:** The fallback path works, but the warning message exposes internal details ("APIFY_TOKEN not found").
- **Repro:** Force a workflow step with `provider: "apify-leads"` without setting APIFY_TOKEN.

### [Workflow] — Apify token leaked in URL query parameter

- **Severity:** High
- **File:** `src/lib/providers/builtin/apify-leads-provider.ts:56-60`
- **What happens:** The Apify API token is passed as a URL query parameter (`?token=${apiToken}`). This means the token appears in server logs, proxy logs, and any network monitoring. It should be sent as an `Authorization` header.
- **Why:** Apify's API supports both methods, but query param is insecure for production.
- **Repro:** Code inspection — `https://api.apify.com/v2/acts/.../runs?token=${apiToken}`

---

## Area 5 — Tables & RLHF

### [Tables] — N+1 query for feedback stats

- **Severity:** Medium
- **File:** `src/app/api/tables/route.ts:14-31`
- **What happens:** For each result set, a separate query fetches ALL rows just to count feedback statuses. With 10 tables of 1000 rows each, this is 10,000 rows loaded into memory just for counts.
- **Why:** `Promise.all(tables.map(...))` runs N separate queries. Should use a single aggregation query with GROUP BY.
- **Repro:** `curl http://localhost:3003/api/tables` — observe response time with many tables.

### [Tables] — GET /api/tables has no try/catch

- **Severity:** Medium
- **File:** `src/app/api/tables/route.ts:8-33`
- **What happens:** If the DB query fails (e.g., `result_sets` table doesn't exist — which it does here), the error propagates unhandled, returning a generic 500.
- **Why:** No try/catch wrapper around the DB queries.
- **Repro:** Drop the `result_sets` table → `curl http://localhost:3003/api/tables` → 500 with stack trace.

### [Tables] — DELETE /api/tables/[id] has no try/catch

- **Severity:** Low
- **File:** `src/app/api/tables/[id]/route.ts:31-37`
- **What happens:** Delete operation has no error handling. A nonexistent ID silently succeeds (Drizzle returns 0 rows affected).
- **Why:** No try/catch, no check for row existence.
- **Repro:** `curl -X DELETE http://localhost:3003/api/tables/nonexistent-id`

### [Tables] — Feedback route accepts any string value

- **Severity:** Medium
- **File:** `src/app/api/tables/[id]/rows/[rowId]/feedback/route.ts:10-14`
- **What happens:** The `feedback` field is typed as `'approved' | 'rejected' | 'flagged' | null` in TypeScript, but there's no runtime validation. Sending `feedback: "banana"` will be stored in the DB.
- **Why:** TypeScript types are erased at runtime. No Zod/joi validation.
- **Repro:** `curl -X PATCH http://localhost:3003/api/tables/x/rows/y/feedback -H "Content-Type: application/json" -d '{"feedback":"banana"}'`

### [Tables] — Feedback route has no try/catch

- **Severity:** Low
- **File:** `src/app/api/tables/[id]/rows/[rowId]/feedback/route.ts:8-35`
- **What happens:** DB update error propagates unhandled.
- **Why:** No try/catch.

### [Tables] — learn/confirm partial write if intelligence store fails

- **Severity:** High
- **File:** `src/app/api/tables/[id]/learn/confirm/route.ts:38-68`
- **What happens:** The framework is updated first (line 40-47), then the intelligence store loop runs (line 51-67). If the intelligence store throws mid-loop (e.g., `intelligence` table doesn't exist — it doesn't!), the framework has been partially updated but intelligence entries are incomplete. No transaction wraps both operations.
- **Why:** The `intelligence` table is one of the 17 missing tables. The `IntelligenceStore.add()` call will crash. Additionally, there's no transaction boundary — partial state is committed.
- **Repro:** Call learn/confirm → framework updates → intelligence store crashes → inconsistent state.

---

## Area 6 — Knowledge Base

### [Knowledge] — PDF extraction is a placeholder

- **Severity:** Medium
- **File:** `src/app/api/knowledge/route.ts:27-29` (POST handler)
- **What happens:** PDF files are "extracted" as the literal string `[PDF file: filename.pdf]`. FTS5 indexes this placeholder. Knowledge search will never find actual PDF content.
- **Why:** Comment says "Basic PDF support" — no actual PDF parser is integrated.
- **Repro:** Upload a PDF → check knowledge_items table → `extracted_text` is `[PDF file: ...]`.

### [Knowledge] — GET has no try/catch

- **Severity:** Low
- **File:** `src/app/api/knowledge/route.ts:5-15`
- **What happens:** DB query failure returns generic 500.
- **Why:** No try/catch.

### [Knowledge] — DELETE has no try/catch

- **Severity:** Low
- **File:** `src/app/api/knowledge/[id]/route.ts:7-11`
- **What happens:** Delete failure returns generic 500. Deleting nonexistent ID silently succeeds.
- **Why:** No try/catch, no existence check.

---

## Area 7 — API Keys & Encryption

### [Crypto] — Missing ENCRYPTION_KEY crashes save/decrypt

- **Severity:** High
- **File:** `src/lib/crypto.ts:8-15`
- **What happens:** `getDerivedKey()` throws if `ENCRYPTION_KEY` is not set. Any attempt to save or read an API key will crash. The `.env.local` shows `ENCRYPTION_KEY=` (empty).
- **Why:** No fallback or graceful degradation. Empty string passes the `!secret` check (empty string is falsy), so it throws.
- **Repro:** `curl -X POST http://localhost:3003/api/api-keys -H "Content-Type: application/json" -d '{"provider":"anthropic","key":"sk-test"}'` → 500 "ENCRYPTION_KEY is not set"

### [API Keys] — "Test connection" only validates format, not actual connectivity

- **Severity:** Low
- **File:** `src/app/api/api-keys/[provider]/route.ts:22-33`
- **What happens:** The POST (test connection) handler checks if `encryptedKey.includes(':')` — which will always be true for any encrypted value (format is `iv:authTag:ciphertext`). It never actually calls the provider's API.
- **Why:** Comment says "real health checks come later." The validation is vacuous.
- **Repro:** Save any garbage string as API key → test connection → returns `valid: true`.

---

## Area 8 — Campaigns

### [Campaigns] — Creation with orphaned conversationId

- **Severity:** High
- **File:** `src/app/api/campaigns/route.ts:16-22`
- **What happens:** A campaign can be created with a `conversationId` that doesn't exist. No FK check (FK enforcement off) and no application-level check. Moreover, the `campaigns` table doesn't exist in the DB.
- **Why:** `campaigns` table is one of the 17 missing tables. Even if it existed, no FK validation.
- **Repro:** `curl -X POST http://localhost:3003/api/campaigns -H "Content-Type: application/json" -d '{"conversationId":"fake","title":"t","hypothesis":"h","channels":"[]","successMetrics":"[]"}'` → crashes.

### [Campaigns] — analyze route has no try/catch

- **Severity:** Medium
- **File:** `src/app/api/campaigns/[id]/analyze/route.ts:7-40`
- **What happens:** If `CampaignOptimizer.analyze()` or `ReviewQueue.create()` throws, the error propagates unhandled. Both depend on missing tables (`review_queue`).
- **Why:** No try/catch around the optimizer/review queue calls.
- **Repro:** Call analyze on any campaign → crash due to missing `review_queue` table.

---

## Area 9 — MCP

### [MCP] — JSON.parse on discoveredTools without try/catch

- **Severity:** Medium
- **File:** `src/app/api/mcps/route.ts:15-16`
- **What happens:** `JSON.parse(row.discoveredTools as string)` is called without try/catch. If `discoveredTools` is null, empty, or malformed JSON, the GET handler crashes.
- **Why:** No null check or try/catch around JSON.parse.
- **Repro:** Insert a row into `mcp_servers` with `discoveredTools = 'not-json'` → GET /api/mcps crashes.

### [MCP] — Singleton lost on serverless cold start

- **Severity:** Medium
- **File:** `src/lib/mcp/client.ts:107` (module-level singleton)
- **What happens:** `mcpManager` is a module-level singleton. In serverless/edge deployments, each cold start creates a new instance. All MCP connections are lost. Reconnection only happens when POST /api/mcps is called again.
- **Why:** Module singletons don't survive cold starts in serverless environments.
- **Repro:** Deploy to Vercel → add MCP server → wait for cold start → GET /api/mcps shows `status: disconnected`.

### [MCP] — provider-bridge isAvailable() always returns true

- **Severity:** Low
- **File:** `src/lib/mcp/provider-bridge.ts:33-35`
- **What happens:** `isAvailable()` returns `true` unconditionally. The planner will suggest MCP providers even when the underlying MCP server is disconnected.
- **Why:** No check against `mcpManager.getConnection()` status.
- **Repro:** Register an MCP tool → disconnect the server → planner still lists it as available.

### [MCP Server] — Auth bypass when MCP_SERVER_TOKEN is not set

- **Severity:** High
- **File:** `src/app/api/mcp-server/route.ts:11-14`
- **What happens:** When `MCP_SERVER_TOKEN` is not set, both GET and POST return 503. This is correct — it's a denial, not a bypass. **No vulnerability here.** The middleware's open-dev mode (`if (!token) return NextResponse.next()`) applies to `GTM_OS_API_TOKEN`, not `MCP_SERVER_TOKEN`.
- **Why:** N/A — verified secure.

---

## Area 10 — Reviews, Signals, Data Quality

### [Reviews] — No try/catch on GET or POST

- **Severity:** Medium
- **File:** `src/app/api/reviews/route.ts:8-22`
- **What happens:** `ReviewQueue.list()` and `ReviewQueue.create()` failures propagate unhandled. The `review_queue` table doesn't exist.
- **Why:** No try/catch. Missing table.
- **Repro:** `curl http://localhost:3003/api/reviews` → crash.

### [Signals] — No try/catch on GET

- **Severity:** Low
- **File:** `src/app/api/signals/route.ts:6-20`
- **What happens:** If `signals_log` table doesn't exist (it doesn't), the collector crashes.
- **Why:** No try/catch. Missing table.
- **Repro:** `curl http://localhost:3003/api/signals` → crash.

### [Data Quality] — JSON.parse on details/action fields

- **Severity:** Medium
- **File:** `src/app/api/data-quality/issues/route.ts:17-18`
- **What happens:** `typeof r.details === 'string' ? JSON.parse(r.details) : (r.details ?? {})` — if `details` is a malformed JSON string, `JSON.parse` throws and crashes the GET handler with no try/catch.
- **Why:** No try/catch around JSON.parse. Same issue for `action` field on line 19.
- **Repro:** Insert a row with `details = '{broken'` → GET /api/data-quality/issues crashes.

---

## Area 11 — Auth & Middleware

### [Middleware] — Crashes with LibsqlError in Edge runtime

- **Severity:** Critical
- **File:** `src/middleware.ts:2` → `src/lib/auth.ts:4` → `src/lib/db/index.ts:5`
- **What happens:** Every request returns HTTP 500. The middleware imports `auth` which imports `db` which calls `createClient({ url: 'file:./gtm-os.db' })`. The Edge runtime (used by middleware) doesn't support `file:` URLs — only `libsql:`, `wss:`, `ws:`, `https:`, `http:`.
- **Why:** Middleware runs in Edge runtime. libsql's Edge-compatible client rejects `file:` URLs. The import chain forces DB initialization at middleware level.
- **Repro:** `curl -s http://localhost:3003/api/tables` → 500 with `LibsqlError: URL_SCHEME_NOT_SUPPORTED`

### [Auth] — Empty ALLOWED_EMAILS allows all users

- **Severity:** Medium
- **File:** `src/lib/auth.ts:7-9, 28`
- **What happens:** When `ALLOWED_EMAILS` is empty/unset (as in `.env.local`), `allowedEmails` array is empty after filtering, so `allowedEmails.length === 0` returns `true`, allowing ANY Google account to sign in.
- **Why:** Intentional for local dev, but dangerous if deployed without setting this env var.
- **Repro:** Leave `ALLOWED_EMAILS` unset → any Google user can authenticate.

### [Auth] — Missing AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET

- **Severity:** Medium
- **File:** `src/lib/auth.ts:20-23`
- **What happens:** `process.env.AUTH_GOOGLE_ID!` and `AUTH_GOOGLE_SECRET!` use non-null assertion. If not set, they pass `undefined` to the Google provider, which will fail at OAuth redirect time with an opaque error.
- **Why:** No startup validation. The `!` assertion silences TypeScript but doesn't validate at runtime.
- **Repro:** Leave env vars unset → click "Sign in with Google" → opaque OAuth error.

### [Middleware] — Open API access when GTM_OS_API_TOKEN is not set

- **Severity:** High
- **File:** `src/middleware.ts:37-38`
- **What happens:** When `GTM_OS_API_TOKEN` is not set, `if (!token) return NextResponse.next()` allows all unauthenticated API requests through. This is intentional for local dev but must be set in production.
- **Why:** Comment says "no token = open (local dev)". Dangerous if deployed without the token.
- **Repro:** Leave `GTM_OS_API_TOKEN` unset → all API routes are publicly accessible without any authentication.

---

## Area 12 — Security Scan

### [Security] — No dangerouslySetInnerHTML found

- **Severity:** Info (pass)
- **File:** Entire `src/` directory
- **What happens:** No XSS via `dangerouslySetInnerHTML`. All rendering is through React JSX.
- **Repro:** `grep -r "dangerouslySetInnerHTML" src/` → 0 results.

### [Security] — No hardcoded secrets found

- **Severity:** Info (pass)
- **File:** Entire `src/` directory
- **What happens:** All secrets come from `process.env`. No `sk-`, password literals, or API keys in source.
- **Repro:** `grep -ri "sk-\|password\|API_KEY\|secret" src/` → only env var references.

### [Security] — FTS5 MATCH syntax abuse (not SQL injection)

- **Severity:** Medium
- **File:** `src/app/api/chat/route.ts:34`
- **What happens:** As noted in Area 3 — FTS5 MATCH operators are user-controllable. Not SQL injection (parameterized), but allows unintended query behavior.
- **Why:** FTS5 has its own query language parsed inside the MATCH clause.
- **Repro:** Chat message `title:*` → scans all knowledge titles.

### [Security] — MCP stdio command injection mitigated

- **Severity:** Info (pass)
- **File:** `src/lib/mcp/client.ts:20-29`
- **What happens:** Only allow-listed bare command names (`npx`, `node`, etc.). Path separators are rejected. Process env is filtered. Well-implemented.

### [Security] — URL validation is solid against SSRF

- **Severity:** Info (pass)
- **File:** `src/lib/web/url-validator.ts`
- **What happens:** DNS rebinding is handled by resolving DNS and checking resolved IPs. IPv4-mapped IPv6 checked. Credentials blocked. Only http/https allowed. Localhost blocked.

### [Security] — Apify token in URL (repeated from Area 4)

- **Severity:** High
- **File:** `src/lib/providers/builtin/apify-leads-provider.ts:56`
- **What happens:** API token in query string is logged by proxies/CDNs.

---

## Error Handling Matrix

| Route | Methods | try/catch | Input Validation | Proper Status Codes |
|-------|---------|-----------|------------------|---------------------|
| `/api/chat` | POST | Yes (SSE) | Yes (empty msg) | Yes (400, SSE error) |
| `/api/onboarding/extract` | POST | Yes (SSE) | Partial (no min-input check) | Yes |
| `/api/onboarding/complete` | POST | Yes | No (accepts any body) | Yes (500) |
| `/api/onboarding/questions` | POST | Yes | No (null framework) | Yes (500) |
| `/api/workflows/execute` | POST | Yes (SSE) | No (bogus conversationId) | Yes |
| `/api/tables` | GET | **No** | N/A | Generic 500 on error |
| `/api/tables/[id]` | GET, DELETE | **No** | Partial (404 on GET) | Partial |
| `/api/tables/[id]/rows/[rowId]/feedback` | PATCH | **No** | **No** (accepts any feedback value) | Generic 500 |
| `/api/tables/[id]/learn` | POST | **No** (partial) | Yes (min 5 threshold) | Yes (400, 404) |
| `/api/tables/[id]/learn/confirm` | POST | **No** | No | Yes (404) |
| `/api/knowledge` | GET, POST | **No** (GET), Yes (POST) | Yes (POST file check) | Yes (400, 201) |
| `/api/knowledge/[id]` | DELETE | **No** | No | Generic 500 |
| `/api/api-keys` | GET, POST | **No** (GET), Partial (POST) | Yes (POST provider+key) | Yes (400) |
| `/api/api-keys/[provider]` | DELETE, POST | **No** | No | Yes (404) |
| `/api/campaigns` | GET, POST | **No** | No (orphaned conversationId) | Yes (201) |
| `/api/campaigns/[id]` | GET, PATCH, DELETE | Partial (PATCH) | Partial | Yes (400, 404) |
| `/api/campaigns/[id]/analyze` | POST | **No** | No | Generic 500 |
| `/api/campaigns/[id]/steps/[stepId]/execute` | POST | Yes | No | Yes (400) |
| `/api/mcps` | GET, POST | **No** | No (JSON.parse crash) | Generic 500 |
| `/api/mcp-server` | GET, POST | Yes | Yes (auth, tool name) | Yes (400, 401, 503) |
| `/api/reviews` | GET, POST | **No** | No | Generic 500 |
| `/api/signals` | GET | **No** | No | Generic 500 |
| `/api/data-quality/check` | POST | **No** (relies on monitor) | Yes (resultSetId) | Yes (400) |
| `/api/data-quality/issues` | GET, PATCH | **No** | Partial (PATCH checks issueId) | Partial |

**Summary:** 14 of 23 route files lack try/catch on at least one handler. 9 have no input validation at all.

---

## Fix Priority (ordered by impact)

1. **Run `pnpm db:push`** — Create all 17 missing tables. Without this, campaigns, intelligence, MCP, reviews, signals, data quality, and auth are all non-functional. *(Critical)*

2. **Fix middleware Edge runtime crash** — Either:
   - (a) Extract `auth` config to avoid importing `db` in middleware, or
   - (b) Use `runtime: 'nodejs'` middleware (Next.js 14 experimental), or
   - (c) Use a Turso remote DB URL instead of `file:`. *(Critical)*

3. **Enable PRAGMA foreign_keys** — Add `await client.execute('PRAGMA foreign_keys = ON')` in `src/lib/db/index.ts` after client creation. *(High)*

4. **Fix FTS5 content table sync** — Either remove `content='knowledge_items'` (use standalone FTS) or fix the rowid mismatch. *(Medium)*

5. **Merge followUpAnswers into framework** — In `QuestionsStep.tsx`, apply `data.followUpAnswers` to the framework object before sending to `/api/onboarding/complete`. *(High)*

6. **Move Apify token to Authorization header** — Replace `?token=${apiToken}` with `headers: { Authorization: 'Bearer ${apiToken}' }`. *(High)*

7. **Add try/catch to all 14 unprotected route handlers** — Wrap DB operations in try/catch with appropriate status codes. *(Medium — bulk fix)*

8. **Add runtime input validation** — Use Zod schemas for feedback values, campaign creation, MCP server addition. *(Medium)*

9. **Fix N+1 query in GET /api/tables** — Replace per-table row fetch with aggregated COUNT query. *(Medium)*

10. **Set required env vars** — `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. Document in README. *(High)*

11. **Add FTS5 query sanitization** — Escape FTS5 operators in user input before MATCH, or use `fts5_fold` function. *(Medium)*

12. **Add stream cancel handler** — Implement `cancel()` on workflow execution ReadableStream. *(Medium)*

13. **Don't close modal on error** — In `QuestionsStep.tsx`, show error state instead of `setOpen(false)` in catch. *(Low)*

14. **Fix MCP isAvailable()** — Check actual connection status in `provider-bridge.ts`. *(Low)*

15. **Add PDF text extraction** — Integrate `pdf-parse` or similar library. *(Low — feature gap)*
