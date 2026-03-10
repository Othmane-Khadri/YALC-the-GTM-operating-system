# Day 8 — Real Qualification Engine + Apify End-to-End Integration

**Date:** 2026-03-10
**Source:** Architecture review of workflow execution pipeline + qualification logic
**Build status:** Compiles clean after Day 7 bug fixes. This brief builds on top of commit `85c36f3`.

---

## What you're building

**Two features, one principle: make the pipeline real.**

Right now, workflow steps run independently — search generates rows, enrich generates rows, qualify generates rows. Each step gets brand-new mock data from Claude. There is **zero row piping** between steps. The qualify step doesn't evaluate the rows from the search/enrich steps — it invents new fake leads and assigns random scores.

After today:
1. **Row piping** — each step receives the rows produced by the previous step
2. **Real qualification** — the qualify step scores *actual upstream data* against the user's ICP framework, not hallucinated leads
3. **Learning injection** — patterns extracted from the RLHF feedback loop feed back into qualify prompts
4. **Apify end-to-end** — verify real Apify providers run, produce data, and the intelligence layer picks them automatically

---

## Read first

Before writing code, read these files in order:

1. `src/app/api/workflows/execute/route.ts` — the SSE execution loop (this is where row piping goes)
2. `src/lib/providers/types.ts` — `ExecutionContext` interface (needs `previousStepRows`)
3. `src/lib/execution/mock-engine.ts` — `generateMockLeads()` (qualify currently hits this)
4. `src/lib/execution/columns.ts` — `QUALIFY_COLUMNS` (only 2 fields — needs more)
5. `src/lib/execution/learning-extractor.ts` — `ExtractedPattern` type
6. `src/lib/ai/workflow-planner.ts` — system prompt (qualify instruction is one line)
7. `src/lib/providers/builtin/mock-provider.ts` — MockProvider class
8. `src/lib/framework/context.ts` — `buildFrameworkContext()` (the ICP rubric source)
9. `src/lib/providers/registry.ts` — provider resolution chain
10. `src/lib/providers/builtin/apify-factory.ts` — how Apify providers wrap catalog entries

---

## Feature 1: Real Qualification Engine

### Problem

The qualify step goes through the same code path as search/enrich. In `execute/route.ts:161`, all three step types hit the same executor. For qualify, the executor is MockProvider, which calls `generateMockLeads()` — a function that generates *new* fake data. It never sees the actual search/enrich rows.

The feedback loop (`/api/tables/[id]/learn`) extracts patterns from user reviews, but those patterns are only saved to the framework's `learnings` array. They never get injected into the qualify step's prompt.

### Fix 1.1 — Add `previousStepRows` to ExecutionContext

**File:** `src/lib/providers/types.ts`

```ts
// CURRENT (line 14-21)
export interface ExecutionContext {
  frameworkContext: string
  knowledgeContext?: string
  apiKey?: string
  mcpClient?: unknown
  batchSize: number
  totalRequested: number
}

// REPLACE WITH
export interface ExecutionContext {
  frameworkContext: string
  knowledgeContext?: string
  learningsContext?: string
  previousStepRows?: Record<string, unknown>[]
  apiKey?: string
  mcpClient?: unknown
  batchSize: number
  totalRequested: number
}
```

### Fix 1.2 — Pipe rows between steps in the execution loop

**File:** `src/app/api/workflows/execute/route.ts`

After the `let totalSoFar = 0` line (~line 121), add a row accumulator:

```ts
let totalSoFar = 0
let previousStepRows: Record<string, unknown>[] = []  // ADD THIS
```

Inside the step execution block (the `for (const step of workflow.steps)` loop), pass `previousStepRows` into the context and collect rows after each step:

```ts
// CURRENT context construction (line 172-177)
const context = {
  frameworkContext,
  knowledgeContext,
  batchSize: 10,
  totalRequested: Math.min(step.estimatedRows || totalRequested, totalRequested - totalSoFar),
}

// REPLACE WITH
const context: ExecutionContext = {
  frameworkContext,
  knowledgeContext,
  learningsContext,
  previousStepRows: previousStepRows.length > 0 ? previousStepRows : undefined,
  batchSize: 10,
  totalRequested: Math.min(step.estimatedRows || totalRequested, totalRequested - totalSoFar),
}
```

After each step completes (after the fallback try/catch, before marking step complete), collect the rows:

```ts
// After the step's rows are inserted (after both the primary and fallback loops)
// Collect rows for the next step to consume
if (step.stepType === 'search' || step.stepType === 'enrich') {
  // Fetch the rows we just inserted for this step
  const stepRows = await db.select({ data: resultRows.data })
    .from(resultRows)
    .where(eq(resultRows.resultSetId, resultSetId))
  previousStepRows = stepRows.map(r => r.data as Record<string, unknown>)
}
```

Also, build the `learningsContext` string. After the `knowledgeContext` section (after ~line 119), add:

```ts
// Fetch learnings for qualification context
let learningsContext = ''
try {
  const [fw] = await db.select().from(frameworks).where(eq(frameworks.userId, 'default')).limit(1)
  if (fw?.data) {
    const framework = fw.data as GTMFramework
    const validated = (framework.learnings || []).filter(
      (l: { confidence: string }) => l.confidence === 'validated' || l.confidence === 'proven'
    )
    if (validated.length > 0) {
      learningsContext = validated
        .slice(-10)
        .map((l: { insight: string; confidence: string }) => `- [${l.confidence}] ${l.insight}`)
        .join('\n')
    }
  }
} catch {
  // No learnings — proceed without
}
```

Add the `GTMFramework` import at the top of the file:

```ts
import type { GTMFramework } from '@/lib/framework/types'
```

And import `ExecutionContext`:

```ts
import type { ExecutionContext } from '@/lib/providers/types'
```

### Fix 1.3 — Build a real qualify executor

**New file:** `src/lib/providers/builtin/qualify-provider.ts`

This is the only new file in the brief. The qualify step should NOT go through MockProvider. It needs its own executor that:
- Takes `previousStepRows` from context
- Scores each row against the user's ICP framework
- Uses `learningsContext` to refine scoring criteria
- Returns the same rows, enriched with `icp_score`, `qualification_reason`, `icp_fit_level`, and `qualification_signals`

```ts
import type { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { getAnthropicClient, QUALIFIER_MODEL } from '@/lib/ai/client'

export const QUALIFY_COLUMNS_FULL: ColumnDef[] = [
  { key: 'icp_score', label: 'ICP Score', type: 'score' },
  { key: 'icp_fit_level', label: 'Fit Level', type: 'badge' },
  { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
  { key: 'qualification_signals', label: 'Signals', type: 'text' },
]

export class QualifyProvider implements StepExecutor {
  id = 'qualify'
  name = 'AI Qualification Engine'
  description = 'Evaluates leads against ICP framework using Claude. Scores existing rows — does not generate new data.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['qualify']

  isAvailable(): boolean {
    return true
  }

  canExecute(step: WorkflowStepInput): boolean {
    return step.stepType === 'qualify'
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    const rows = context.previousStepRows
    if (!rows || rows.length === 0) {
      // No upstream data — yield empty
      yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      return
    }

    const anthropic = getAnthropicClient()
    const batchSize = context.batchSize || 10
    const batches = Math.ceil(rows.length / batchSize)
    let totalSoFar = 0

    for (let i = 0; i < batches; i++) {
      const slice = rows.slice(i * batchSize, (i + 1) * batchSize)

      const rowsForPrompt = slice.map((row, idx) => {
        const fields = Object.entries(row)
          .map(([k, v]) => `  ${k}: ${v ?? '—'}`)
          .join('\n')
        return `Lead ${idx + 1}:\n${fields}`
      }).join('\n\n')

      const prompt = `You are a lead qualification engine. Score each lead against the ICP criteria below.

## ICP Framework
${context.frameworkContext || 'No ICP framework loaded. Use general B2B qualification criteria (company size, relevance, seniority).'}

${context.learningsContext ? `## Historical Learnings (from user feedback)\n${context.learningsContext}\n\nApply these patterns when scoring. They reflect what this specific user considers a good or bad lead.` : ''}

## Qualification Criteria
${step.description || 'Score leads based on ICP fit. Consider company relevance, role seniority, company size, and alignment with pain points.'}

## Leads to Qualify (${slice.length} leads)
${rowsForPrompt}

Score each lead. Be discriminating — not every lead is a good fit.
- icp_score: 0-100 integer. 80+ = strong fit, 50-79 = moderate, below 50 = poor
- icp_fit_level: "Strong", "Moderate", or "Poor"
- qualification_reason: 1-2 sentences explaining WHY this score
- qualification_signals: Comma-separated positive/negative signals (e.g. "+right industry, +senior title, -small company")`

      const response = await anthropic.messages.create({
        model: QUALIFIER_MODEL,
        max_tokens: 4096,
        tools: [{
          name: 'score_leads',
          description: 'Score an array of leads with ICP qualification data',
          input_schema: {
            type: 'object' as const,
            properties: {
              scored_leads: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    lead_index: { type: 'number' },
                    icp_score: { type: 'number' },
                    icp_fit_level: { type: 'string', enum: ['Strong', 'Moderate', 'Poor'] },
                    qualification_reason: { type: 'string' },
                    qualification_signals: { type: 'string' },
                  },
                  required: ['lead_index', 'icp_score', 'icp_fit_level', 'qualification_reason', 'qualification_signals'],
                },
              },
            },
            required: ['scored_leads'],
          },
        }],
        tool_choice: { type: 'tool' as const, name: 'score_leads' },
        messages: [{ role: 'user', content: prompt }],
      })

      // Merge scores into original rows
      let scoredLeads: Array<{
        lead_index: number
        icp_score: number
        icp_fit_level: string
        qualification_reason: string
        qualification_signals: string
      }> = []

      for (const block of response.content) {
        if (block.type === 'tool_use' && block.name === 'score_leads') {
          const input = block.input as { scored_leads: typeof scoredLeads }
          scoredLeads = input.scored_leads || []
        }
      }

      const enrichedRows = slice.map((originalRow, idx) => {
        const score = scoredLeads.find(s => s.lead_index === idx + 1) || scoredLeads[idx]
        return {
          ...originalRow,
          icp_score: score?.icp_score ?? 50,
          icp_fit_level: score?.icp_fit_level ?? 'Moderate',
          qualification_reason: score?.qualification_reason ?? 'Unable to qualify',
          qualification_signals: score?.qualification_signals ?? '',
        }
      })

      totalSoFar += enrichedRows.length

      yield {
        rows: enrichedRows,
        batchIndex: i,
        totalSoFar,
      }
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return QUALIFY_COLUMNS_FULL
  }
}
```

### Fix 1.4 — Register the QualifyProvider

**File:** `src/lib/providers/registry.ts`

```ts
// ADD import at top (after mock-provider import)
import { QualifyProvider } from './builtin/qualify-provider'

// ADD registration (after MockProvider registration, line 102)
registry.register(new QualifyProvider())
```

### Fix 1.5 — Update columns.ts with expanded qualify columns

**File:** `src/lib/execution/columns.ts`

```ts
// CURRENT (line 56-59)
export const QUALIFY_COLUMNS: ColumnDef[] = [
  { key: 'icp_score', label: 'ICP Score', type: 'score' },
  { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
]

// REPLACE WITH
export const QUALIFY_COLUMNS: ColumnDef[] = [
  { key: 'icp_score', label: 'ICP Score', type: 'score' },
  { key: 'icp_fit_level', label: 'Fit Level', type: 'badge' },
  { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
  { key: 'qualification_signals', label: 'Signals', type: 'text' },
]
```

### Fix 1.6 — Handle qualify step differently in execute/route.ts

The qualify step should NOT insert new rows — it should **replace** the existing rows with scored versions. In the execution loop, after the qualify step runs, update existing rows instead of inserting new ones.

**File:** `src/app/api/workflows/execute/route.ts`

Inside the `for await (const batch of executor.execute(...))` block, differentiate between qualify and other steps:

```ts
// CURRENT row insertion block (line 186-194)
for await (const batch of executor.execute(stepInput, context)) {
  const rowsToInsert = batch.rows.map((lead, idx) => ({
    resultSetId,
    rowIndex: totalSoFar + idx,
    data: JSON.stringify(lead),
  }))

  if (rowsToInsert.length > 0) {
    await db.insert(resultRows).values(rowsToInsert)
  }

  totalSoFar += batch.rows.length
  stepRowCount += batch.rows.length

  send({
    type: 'row_batch',
    rows: batch.rows,
    totalSoFar,
  })
}

// REPLACE WITH
for await (const batch of executor.execute(stepInput, context)) {
  if (step.stepType === 'qualify' && previousStepRows.length > 0) {
    // Qualify: update existing rows in-place with scored data
    const existingRows = await db.select().from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))
    for (const row of batch.rows) {
      const rowIndex = batch.rows.indexOf(row) + (batch.batchIndex * context.batchSize)
      const existing = existingRows[rowIndex]
      if (existing) {
        await db.update(resultRows)
          .set({ data: JSON.stringify(row), updatedAt: new Date() })
          .where(eq(resultRows.id, existing.id))
      }
    }
    stepRowCount += batch.rows.length
  } else {
    // Search/Enrich: insert new rows
    const rowsToInsert = batch.rows.map((lead, idx) => ({
      resultSetId,
      rowIndex: totalSoFar + idx,
      data: JSON.stringify(lead),
    }))

    if (rowsToInsert.length > 0) {
      await db.insert(resultRows).values(rowsToInsert)
    }

    totalSoFar += batch.rows.length
    stepRowCount += batch.rows.length
  }

  send({
    type: 'row_batch',
    rows: batch.rows,
    totalSoFar: step.stepType === 'qualify' ? totalSoFar : totalSoFar,
  })
}
```

Also update the `columnsDefinition` after qualify runs to include the new columns. After the qualify step completes:

```ts
// After qualify step completes, update the result set columns to include qualify fields
if (step.stepType === 'qualify') {
  const currentCols = JSON.parse(
    (await db.select({ c: resultSets.columnsDefinition }).from(resultSets).where(eq(resultSets.id, resultSetId)))[0]?.c as string || '[]'
  ) as ColumnDef[]
  const qualifyCols = [
    { key: 'icp_score', label: 'ICP Score', type: 'score' },
    { key: 'icp_fit_level', label: 'Fit Level', type: 'badge' },
    { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
    { key: 'qualification_signals', label: 'Signals', type: 'text' },
  ]
  const mergedCols = [...currentCols]
  for (const qc of qualifyCols) {
    if (!mergedCols.find(c => c.key === qc.key)) {
      mergedCols.push(qc as ColumnDef)
    }
  }
  await db.update(resultSets)
    .set({ columnsDefinition: JSON.stringify(mergedCols) })
    .where(eq(resultSets.id, resultSetId))

  send({
    type: 'columns_updated',
    columns: mergedCols,
  })
}
```

Add `columns_updated` to the execution event types:

**File:** `src/lib/ai/types.ts`

Find the `ExecutionEventType` union and add `'columns_updated'` to it.

### Fix 1.7 — Update the workflow planner's qualify instruction

**File:** `src/lib/ai/workflow-planner.ts`

```ts
// CURRENT (line 174-176)
- **qualify**: Use AI to judge fit against ICP or criteria
- **filter**: Apply rule-based filters (headcount, funding, etc.)
- **export**: Output to CSV, CRM, or trigger outreach

// REPLACE WITH
- **qualify**: AI-powered ICP scoring. Evaluates rows from previous steps against the user's framework. Produces icp_score (0-100), fit level, reasoning, and signals. Always place AFTER search/enrich steps — it needs upstream data to score. Provider: "qualify".
- **filter**: Apply rule-based filters (headcount, funding, etc.)
- **export**: Output to CSV, CRM, or trigger outreach
```

---

## Feature 2: Apify End-to-End Integration Test

### Problem

The Apify providers exist in the catalog. The factory wraps them. `runApifyActor()` starts actors and polls. But we've never confirmed the full chain works end-to-end: planner picks an Apify provider → factory creates executor → `runApifyActor` starts the actor → polling completes → `normalizeRow` maps fields → rows land in the result table.

The intelligence layer (`ProviderIntelligence`) records stats after each execution, but with no real executions it has no data. After real Apify runs, auto-selection should begin working.

### Fix 2.1 — Create an Apify integration test route

**New file:** `src/app/api/test/apify/route.ts`

This is a developer-only test route that runs a small Apify actor to verify the full chain.

```ts
import { NextRequest } from 'next/server'
import { getRegistry } from '@/lib/providers/registry'
import { ProviderIntelligence } from '@/lib/providers/intelligence'
import type { ExecutionContext } from '@/lib/providers/types'

export async function POST(req: NextRequest) {
  try {
    const { provider, query, maxResults } = await req.json() as {
      provider?: string
      query?: string
      maxResults?: number
    }

    const registry = getRegistry()
    const intelligence = new ProviderIntelligence()

    // Step 1: Resolve provider (test auto-selection if no provider specified)
    const stepType = 'search'
    const providerId = provider || 'apify-google-search' // safe default — cheap, fast

    let executor = await registry.resolveAsync({ stepType, provider: providerId })
    const resolvedVia = executor.id === providerId ? 'exact' : 'intelligence'

    // Step 2: Health check
    const health = executor.healthCheck ? await executor.healthCheck() : { ok: true, message: 'No health check' }
    if (!health.ok) {
      return Response.json({ error: `Health check failed: ${health.message}` }, { status: 503 })
    }

    // Step 3: Execute with a small batch
    const context: ExecutionContext = {
      frameworkContext: '',
      batchSize: 5,
      totalRequested: maxResults || 5,
    }

    const stepInput = {
      stepIndex: 0,
      title: 'Apify E2E Test',
      stepType,
      provider: providerId,
      description: query || 'SaaS companies hiring SDRs',
      estimatedRows: maxResults || 5,
      config: { query: query || 'SaaS companies hiring SDRs' },
    }

    const startTime = Date.now()
    const allRows: Record<string, unknown>[] = []

    for await (const batch of executor.execute(stepInput, context)) {
      allRows.push(...batch.rows)
    }

    const latencyMs = Date.now() - startTime

    // Step 4: Record to intelligence
    await intelligence.recordExecution(
      executor.id,
      { stepType },
      { rowCount: allRows.length, latencyMs, costEstimate: 0 },
    )

    // Step 5: Test auto-selection after recording
    const bestAfter = await intelligence.getBestProvider({
      stepType,
      capabilities: ['search'],
    })

    return Response.json({
      success: true,
      resolvedProvider: executor.id,
      resolvedVia,
      health,
      rowCount: allRows.length,
      latencyMs,
      sampleRows: allRows.slice(0, 3),
      columns: executor.getColumnDefinitions(stepInput).map(c => c.key),
      intelligenceAfter: bestAfter,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Apify test failed'
    return Response.json({ error: message, stack: err instanceof Error ? err.stack : undefined }, { status: 500 })
  }
}
```

### Fix 2.2 — Verify provider isAvailable() gates the planner

**File:** `src/lib/providers/registry.ts` — `getAvailableForPlanner()` (line 88-95)

This already filters by `p.isAvailable()`. And `createApifyProvider.isAvailable()` checks `process.env.APIFY_TOKEN`. This means if the user doesn't have an Apify token, Apify providers won't show up in the planner prompt. **No code change needed — just confirm this during testing.**

### Fix 2.3 — Add cost estimate passthrough from Apify catalog

The execution loop records `costEstimate: currentStep?.costEstimate ?? 0` which is always 0 (Bug #16 from the QA brief — was listed P2 and deferred). While testing Apify, set a reasonable default cost based on the catalog description.

**File:** `src/lib/providers/builtin/apify-catalog.ts`

Add a `costPer1k` field to each catalog entry:

```ts
// ADD to ApifyActorEntry interface (in this file, line 4-13)
export interface ApifyActorEntry {
  id: string
  actorId: string
  name: string
  description: string
  capabilities: ProviderCapability[]
  columns: ColumnDef[]
  costPer1k: number  // ADD THIS — estimated cost per 1000 results in USD
  buildInput(config: Record<string, unknown>, step: WorkflowStepInput): Record<string, unknown>
  normalizeRow(raw: Record<string, unknown>): Record<string, unknown>
}
```

Then add `costPer1k` to each entry:
- `apify-leads`: `costPer1k: 1.50`
- `apify-linkedin-profiles`: `costPer1k: 1.50`
- `apify-linkedin-engagement`: `costPer1k: 1.20`
- `apify-google-maps`: `costPer1k: 4.00`
- `apify-contact-info`: `costPer1k: 0.50`
- `apify-google-search`: `costPer1k: 2.00`
- `apify-linkedin-jobs`: `costPer1k: 1.00`
- `apify-website-crawler`: `costPer1k: 1.00`

**File:** `src/lib/providers/builtin/apify-factory.ts`

Update `execute()` to calculate cost and pass it through somehow. The simplest approach: emit cost info that the execution loop can use.

Actually, since the cost recording happens in `execute/route.ts` after the step, we need the factory to expose cost info. Add a method or record it via the intelligence system directly in the factory:

```ts
// In the execute generator, after runApifyActor completes:
const estimatedCost = (rawResults.length / 1000) * entry.costPer1k
// This gets recorded by the execution loop via intelligence.recordExecution
```

The execution loop already calls `intelligence.recordExecution()` but passes `costEstimate: currentStep?.costEstimate ?? 0`. The cleanest fix is to store cost on the step row when the step starts. But that requires knowing the row count upfront — which we don't.

**Simpler approach:** After the Apify provider yields all batches, store cost on the executor object so the execution loop can read it. But generators don't allow post-execution state easily.

**Simplest approach:** Record cost inside the factory's execute function directly:

```ts
// In apify-factory.ts execute(), after the for loop that yields batches:
// After all batches yielded, the execution loop records via intelligence
// The cost estimate is totalRows / 1000 * costPer1k
// We can't easily pass this back, so just set it on the step in the DB
```

**Actually simplest:** Compute cost in the execution loop. After the step finishes, we know `stepRowCount`. Use the catalog to look it up:

**File:** `src/app/api/workflows/execute/route.ts`

After the step execution and before `providerIntelligence.recordExecution()`, compute the cost:

```ts
// ADD import at top
import { APIFY_CATALOG } from '@/lib/providers/builtin/apify-catalog'

// Inside the step completion block (before recordExecution), replace the costEstimate:
const catalogEntry = APIFY_CATALOG.find(e => e.id === usedExecutor.id)
const estimatedCost = catalogEntry
  ? (stepRowCount / 1000) * catalogEntry.costPer1k
  : (currentStep?.costEstimate ?? 0)

// Then use estimatedCost instead of currentStep?.costEstimate ?? 0
await providerIntelligence.recordExecution(
  usedExecutor.id,
  { stepType: step.stepType },
  { rowCount: stepRowCount, latencyMs, costEstimate: estimatedCost },
)

// Also update the step record with the cost
if (currentStep) {
  await db.update(workflowSteps)
    .set({ costEstimate: estimatedCost })
    .where(eq(workflowSteps.id, currentStep.id))
}
```

---

## Testing checklist

After implementing, verify each scenario:

1. **Qualify without upstream rows** — create a workflow with only a qualify step. Should return empty gracefully, not crash.
2. **Search → Qualify pipeline** — run "Find 10 SaaS companies" → "Qualify against ICP". The qualify step should score the actual 10 rows from search, not invent new ones. Check that the result table shows the original search columns PLUS the 4 qualify columns.
3. **Search → Enrich → Qualify** — full 3-step pipeline. Qualify should see the enriched rows.
4. **Learning injection** — add some approved/rejected feedback to a previous result set, run `/api/tables/[id]/learn` to extract patterns, then run a new workflow with qualify. The qualify prompt should include the learnings.
5. **Apify E2E** — hit `POST /api/test/apify` with `{ "provider": "apify-google-search", "query": "best CRM software", "maxResults": 5 }`. Should return real Google search results, not mock data. Verify `resolvedVia: "exact"`, `rowCount > 0`, `sampleRows` have real data.
6. **Auto-selection** — after the Apify test records stats, hit the test endpoint again WITHOUT specifying a provider. The intelligence layer should pick the provider with the best score.
7. **Mock fallback** — unset APIFY_TOKEN temporarily. Run a workflow. Should fall back to mock with a `step_warning` SSE event.
8. **Build clean** — `pnpm build` must pass with zero errors.

---

## Process

1. Implement Feature 1 (fixes 1.1–1.7) in order — types first, then execution loop, then provider, then registry, then planner
2. `pnpm build` — must pass
3. Implement Feature 2 (fixes 2.1–2.3)
4. `pnpm build` — must pass
5. Run through testing checklist manually (or write quick API tests)
6. Write `tasks/day-08-report.md`
7. Commit: atomic per feature group

## Commit Convention

```
feat: real qualification engine — row piping + ICP scoring (Day 08)
feat: apify e2e integration test + cost tracking (Day 08)
```
