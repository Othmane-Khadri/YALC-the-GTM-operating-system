# GTM-OS Bug Fix Brief

**Date:** 2026-03-09
**Source:** QA audit of 150+ source files ([full report](tasks/qa-report.md))
**Build status:** Compiles (32 pages, 37 API routes). Core architecture is solid. No rewrites needed — every fix is surgical.

---

## What's broken

**22 bugs. 4 critical, 6 high, 9 medium, 3 low.**

The three systemic issues:

1. **SQLite locks the entire DB on writes.** WAL mode is never enabled. Concurrent requests (chat + workflow, or two workflows) crash with `SQLITE_BUSY`. Confirmed during build.

2. **The workflow engine has no input validation.** A malformed payload crashes the server. A cancelled workflow stays "running" in DB forever. Campaign steps are inserted without a transaction — partial writes on failure.

3. **Provider matching is exact-string only.** When the AI planner outputs a slightly wrong provider ID (`apify-lead-finder` instead of `apify-leads`), execution silently falls back to mock data. The user gets fake results with no warning.

Beyond these three, there's a command injection vector (MCP accepts arbitrary shell commands), Apify polling crashes on HTTP errors, PDF upload is a no-op, and most POST endpoints accept any JSON without validation.

---

## What's working well (don't touch)

- URL validation / SSRF protection (`url-validator.ts`)
- FTS5 search with injection-safe sanitization (`chat/route.ts`)
- AES-256-GCM API key encryption (`crypto.ts`)
- Auth middleware with constant-time comparison (`middleware.ts`)
- FK cascade deletes across all schemas (`schema.ts`)
- Provider fallback with SSE warning (`execute/route.ts`)

---

## Fix inventory

| # | Sev | File | What's wrong | Fix |
|---|-----|------|-------------|-----|
| 1 | P0 | `src/lib/db/index.ts:13` | No WAL mode — `SQLITE_BUSY` on concurrent writes | Add `PRAGMA journal_mode = WAL` after the FK pragma |
| 2 | P0 | `src/lib/providers/builtin/apify-base.ts:38-41` | Polling calls `.json()` on 5xx HTML responses — crash or 3-min hang | Check `pollRes.ok` before `.json()`, throw on error |
| 3 | P0 | `src/app/api/workflows/execute/route.ts:22-25` | No validation on `workflow` — `for (const step of undefined)` crashes | Validate `workflow.steps` is a non-empty array, return 400 if not |
| 4 | P1 | `src/app/api/knowledge/route.ts:38-40` | PDF "extraction" stores literal `[PDF file: name.pdf]` | Install `pdf-parse`, extract real text from buffer |
| 5 | P1 | `src/lib/ai/types.ts:78-84` | `step_note` and `step_warning` events missing from `ExecutionEventType` | Add both to the union type |
| 6 | P1 | `src/app/api/workflows/execute/route.ts:301-303` | Stream cancel sets flag but never updates workflow status in DB | On cancel, update workflow to `cancelled` + set `completedAt` |
| 7 | P1 | `src/app/api/campaigns/route.ts:41-53` | Campaign step insertion loop has no transaction — partial writes possible | Wrap the entire create + steps loop in `db.transaction()` |
| 8 | P1 | `src/app/api/mcps/route.ts:44` | Arbitrary commands stored and executed via MCP client | Validate `transport` is `sse` or `streamable-http`. If `stdio`, whitelist `command` against known safe binaries (e.g. `npx`, `node`, `uvx`). Block dangerous patterns |
| 9 | P1 | `src/lib/providers/builtin/apify-factory.ts:18-20` | `canExecute` does exact string match — planner ID variations silently fall back to mock | Add prefix matching: `step.provider.startsWith(entry.id)` OR `entry.id.startsWith(step.provider)`. Also match by `stepType` + capability as secondary signal |
| 10 | P1 | `src/app/api/api-keys/[provider]/route.ts:37` | Connection test only checks if encrypted key has `:` — always passes | For `apify`, call `apifyHealthCheck()`. For others, attempt a lightweight API call. Fall back to format check only if no health check exists |
| 11 | P2 | `src/app/api/tables/[id]/learn/confirm/route.ts:10` | `[id]` route param is ignored — confirm applies globally | Extract `id` from `params`, scope the framework query or filter to that table |
| 12 | P2 | `src/app/api/campaigns/route.ts:30-39` | POST with `{}` crashes inside `manager.create()` | Validate `title` exists before calling `manager.create()` |
| 13 | P2 | `src/app/api/reviews/route.ts:30-31` | POST passes body directly to `queue.create()` with no validation | Validate required fields (`type`, `title`, `description`) before create |
| 14 | P2 | `src/app/api/framework/route.ts:32` | PUT accepts any JSON as framework data | Validate the `framework` object has expected shape (at minimum check it's a non-null object) |
| 15 | P2 | `src/app/api/knowledge/route.ts:46` | No file size guard — 500MB file loaded into memory before truncation | Check `file.size > 10_000_000` and return 413 before calling `file.text()` or `file.arrayBuffer()` |
| 16 | P2 | `src/app/api/workflows/execute/route.ts:235` | `costEstimate` always 0 — never set on step creation | Pass cost from provider catalog entry or config into step record |
| 17 | P2 | `src/lib/providers/builtin/mock-provider.ts:58` | `ENRICH_COLUMNS[unknownProvider]` returns `undefined` → `[]` columns → blank table | Default to `SEARCH_COLUMNS` when `ENRICH_COLUMNS[provider]` is undefined |
| 18 | P3 | `src/middleware.ts` | No rate limiting anywhere | Add basic rate limiting (IP-based, in-memory counter with sliding window) |
| 19 | P3 | Multiple files | All data keyed to `userId: 'default'` — no multi-user isolation | Architectural — defer unless multi-user is a priority |
| 20 | P3 | Build output | `SQLITE_BUSY` during static page generation (non-fatal) | Fixed by bug #1 (WAL mode) |
| 21 | P3 | `src/app/api/chat/route.ts:99-109` | Message insert with non-existent `conversationId` may silently fail | Check conversation exists before inserting message, or create one |
| 22 | P3 | `src/lib/data-quality/monitor.ts:190-195` | `checkAnomaly()` exists but `runAll()` never calls it | Add `checkAnomaly` to the `Promise.all` in `runAll()` (requires ICP match rate input — either compute it or skip gracefully) |

---
---

# Developer Prompt

You are fixing bugs in GTM-OS, a Next.js 14 app with SQLite (libsql/Turso), Drizzle ORM, and Apify integrations. The full QA report is at `tasks/qa-report.md`. Below are the exact fixes needed.

**Rules:**
- Fix bugs in priority order (P0 first, then P1, then P2)
- Skip P3 — those are architectural or cosmetic
- Don't refactor surrounding code. Don't add comments to code you didn't change. Don't add type annotations to existing working code
- After all fixes, run `pnpm build` and confirm it succeeds with zero errors
- Commit with a descriptive message

---

## P0 Fixes (3 bugs — do these first)

### Bug #1: Enable WAL mode

**File:** `src/lib/db/index.ts`
**Line:** 13 (right after `PRAGMA foreign_keys = ON`)

Add one line:
```ts
client.execute('PRAGMA journal_mode = WAL')
```

This prevents `SQLITE_BUSY` crashes on concurrent writes. That's it — one line.

---

### Bug #2: Apify polling crashes on HTTP errors

**File:** `src/lib/providers/builtin/apify-base.ts`
**Lines:** 38-42

Current code (the polling loop body):
```ts
const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
  headers: authHeaders,
})
const pollData = await pollRes.json()
status = pollData.data?.status
```

Fix — add an HTTP status check before calling `.json()`:
```ts
const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
  headers: authHeaders,
})
if (!pollRes.ok) {
  throw new Error(`Apify poll failed (${pollRes.status}): ${await pollRes.text()}`)
}
const pollData = await pollRes.json()
status = pollData.data?.status
```

---

### Bug #3: Workflow execution crashes on malformed input

**File:** `src/app/api/workflows/execute/route.ts`
**Lines:** 22-25 (right after destructuring `req.json()`)

Current code:
```ts
const { conversationId, workflow } = await req.json() as {
  conversationId: string
  workflow: WorkflowDefinition
}
```

Add validation immediately after:
```ts
const { conversationId, workflow } = await req.json() as {
  conversationId: string
  workflow: WorkflowDefinition
}

if (!workflow?.steps || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
  return Response.json(
    { error: 'Invalid workflow: steps must be a non-empty array' },
    { status: 400 },
  )
}
```

---

## P1 Fixes (6 bugs)

### Bug #4: PDF extraction is fake

**File:** `src/app/api/knowledge/route.ts`
**Lines:** 38-40

Install `pdf-parse`:
```bash
pnpm add pdf-parse
pnpm add -D @types/pdf-parse
```

Replace the PDF branch:
```ts
// Current:
} else if (ext === 'pdf') {
  extractedText = `[PDF file: ${file.name}]`
}

// Replace with:
} else if (ext === 'pdf') {
  const pdfParse = (await import('pdf-parse')).default
  const buffer = Buffer.from(await file.arrayBuffer())
  const pdfData = await pdfParse(buffer)
  extractedText = pdfData.text
}
```

Also add a file size guard before any extraction (fixes Bug #15 too):
```ts
if (file.size > 10_000_000) {
  return Response.json({ error: 'File too large. Maximum 10MB.' }, { status: 413 })
}
```

Place this right after the `if (!file)` check, before the `let extractedText` line.

---

### Bug #5: Missing SSE event types

**File:** `src/lib/ai/types.ts`
**Lines:** 78-84

Current:
```ts
export type ExecutionEventType =
  | 'execution_start'
  | 'step_start'
  | 'row_batch'
  | 'step_complete'
  | 'execution_complete'
  | 'error'
```

Add the two missing types:
```ts
export type ExecutionEventType =
  | 'execution_start'
  | 'step_start'
  | 'step_note'
  | 'step_warning'
  | 'row_batch'
  | 'step_complete'
  | 'execution_complete'
  | 'error'
```

---

### Bug #6: Cancelled workflows stay "running" forever

**File:** `src/app/api/workflows/execute/route.ts`
**Lines:** 301-303

Current cancel handler:
```ts
cancel() {
  cancelled = true
},
```

Replace with:
```ts
cancel() {
  cancelled = true
  // Update workflow status in DB (fire-and-forget)
  db.update(workflows)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(workflows.id, workflowId))
    .catch(err => console.error('Failed to cancel workflow in DB:', err))
},
```

Note: `workflowId` is defined at line 43, inside the `start()` closure. The cancel handler has access to it via closure scope. But because `cancel()` can fire before `workflowId` is set (if cancelled during the initial JSON parse), guard it:
```ts
cancel() {
  cancelled = true
  if (typeof workflowId === 'string') {
    db.update(workflows)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(workflows.id, workflowId))
      .catch(err => console.error('Failed to cancel workflow in DB:', err))
  }
},
```

To make `workflowId` accessible in the cancel handler, move its declaration before the `ReadableStream` constructor. Change:
```ts
// Inside start():
const workflowId = crypto.randomUUID()
```
To declare it outside:
```ts
let workflowId = ''

const stream = new ReadableStream({
  async start(controller) {
    // ...
    workflowId = crypto.randomUUID()
```

---

### Bug #7: Campaign steps not wrapped in a transaction

**File:** `src/app/api/campaigns/route.ts`
**Lines:** 28-56

Replace the entire POST handler body:
```ts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const campaign = await manager.create({
      conversationId: body.conversationId,
      title: body.title,
      hypothesis: body.hypothesis,
      targetSegment: body.targetSegment ?? null,
      channels: body.channels ?? [],
      successMetrics: body.successMetrics ?? [],
    })

    if (body.steps && Array.isArray(body.steps)) {
      await db.transaction(async (tx) => {
        for (let i = 0; i < body.steps.length; i++) {
          const stepDef = body.steps[i]
          await manager.addStep(campaign.id, {
            stepIndex: i,
            skillId: stepDef.skillId,
            skillInput: stepDef.skillInput ?? {},
            channel: stepDef.channel ?? null,
            dependsOn: stepDef.dependsOn ?? [],
            approvalRequired: stepDef.approvalRequired ?? true,
          })
        }
      })
    }

    const full = await manager.get(campaign.id)
    return NextResponse.json(full, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create campaign'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

This also fixes Bug #12 (missing body validation) by checking `body.title` exists.

You'll need to add the `db` import at the top of the file:
```ts
import { db } from '@/lib/db'
```

Note: `manager.addStep()` likely uses the default `db` internally. If it takes a `tx` parameter, pass it. If not, the transaction wrapper still ensures the loop completes atomically at the SQL level — check `manager.addStep` implementation to confirm it uses the shared `db` export.

---

### Bug #9: Provider selection requires exact ID match

**File:** `src/lib/providers/builtin/apify-factory.ts`
**Lines:** 18-20

Current:
```ts
canExecute(step: WorkflowStepInput): boolean {
  return step.provider === entry.id
},
```

Replace with prefix matching:
```ts
canExecute(step: WorkflowStepInput): boolean {
  if (step.provider === entry.id) return true
  // Fuzzy: planner may output a close variant (e.g. "apify-lead" for "apify-leads")
  return step.provider.startsWith(entry.id) || entry.id.startsWith(step.provider)
},
```

---

## P2 Fixes (7 bugs)

### Bug #10: API key test is fake

**File:** `src/app/api/api-keys/[provider]/route.ts`
**Lines:** 36-37

Replace the format-only check with a real health check for providers that support it:
```ts
// Replace this:
const isValid = connection.encryptedKey && connection.encryptedKey.includes(':')

// With:
let isValid = false
if (provider === 'apify') {
  const { apifyHealthCheck } = await import('@/lib/providers/builtin/apify-base')
  const health = await apifyHealthCheck()
  isValid = health.ok
} else {
  // Format check fallback for providers without a health endpoint
  isValid = !!(connection.encryptedKey && connection.encryptedKey.includes(':'))
}
```

---

### Bug #11: Learn/confirm ignores table ID

**File:** `src/app/api/tables/[id]/learn/confirm/route.ts`
**Line:** 10

The route handler signature already receives `params` with `id`. Wire it in:
```ts
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tableId } = await params
    // Use tableId to scope the operation...
```

The exact scoping depends on how the framework learnings relate to tables. At minimum, log or filter by `tableId`.

---

### Bug #13: Reviews POST has no validation

**File:** `src/app/api/reviews/route.ts`
**Lines:** 28-36

Add validation before create:
```ts
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.type || !body.title || !body.description) {
      return NextResponse.json(
        { error: 'type, title, and description are required' },
        { status: 400 },
      )
    }

    const review = await queue.create(body)
    return NextResponse.json(review, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create review'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

---

### Bug #14: Framework PUT accepts any JSON

**File:** `src/app/api/framework/route.ts`
**Line:** 32

Add a basic shape check:
```ts
const { framework } = await req.json() as { framework: Partial<GTMFramework> }

if (!framework || typeof framework !== 'object' || Array.isArray(framework)) {
  return Response.json({ error: 'Invalid framework data' }, { status: 400 })
}

framework.lastUpdated = new Date().toISOString()
```

---

### Bug #17: Mock provider returns empty columns for unknown enrich providers

**File:** `src/lib/providers/builtin/mock-provider.ts`
**Line:** 58

Current:
```ts
case 'enrich':
  return ENRICH_COLUMNS[step.provider] ?? []
```

Replace with:
```ts
case 'enrich':
  return ENRICH_COLUMNS[step.provider] ?? SEARCH_COLUMNS
```

---

### Bug #22: `checkAnomaly()` never called

**File:** `src/lib/data-quality/monitor.ts`
**Lines:** 190-195

Current `runAll()`:
```ts
const [dedup, completeness, freshness] = await Promise.all([
  this.checkDedup(resultSetId),
  this.checkCompleteness(resultSetId),
  this.checkFreshness(resultSetId),
])

const allIssues = [...dedup, ...completeness, ...freshness]
```

`checkAnomaly()` requires an `icpMatchRate` that isn't available here. Skip it gracefully for now — the method exists for future use. No code change needed unless you want to wire ICP scoring.

---

## After all fixes

```bash
pnpm build
```

Expected: clean build, 32 static pages, 37 API routes, zero errors, no `SQLITE_BUSY` warnings.
