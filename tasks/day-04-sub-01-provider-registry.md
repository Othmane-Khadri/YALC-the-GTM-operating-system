# Sub-Brief 4.1 — Provider Registry + StepExecutor Interface

**Goal:** Replace the hardcoded `WorkflowProvider` union with a dynamic provider registry. Every provider (built-in, MCP, or mock) implements the same `StepExecutor` interface. The workflow planner receives available providers at runtime instead of a static list.

---

## Read These Files First

Read every file listed below before writing any code. Understand the current shapes, imports, and patterns.

1. `src/lib/ai/types.ts` — `WorkflowProvider` hardcoded union type
2. `src/lib/execution/mock-engine.ts` — current execution pattern (`generateMockLeads`)
3. `src/lib/execution/columns.ts` — column definitions per provider (`SEARCH_COLUMNS`, etc.)
4. `src/lib/ai/workflow-planner.ts` — static provider list baked into the system prompt
5. `src/lib/skills/types.ts` + `src/lib/skills/registry.ts` — placeholder skills system (we are replacing this later in 4.4, leave it alone for now)
6. `src/app/api/workflows/execute/route.ts` — current execution orchestrator (SSE streaming, DB writes)

---

## New Files to Create

### `src/lib/providers/types.ts`

Define all provider-system types here. No runtime logic, only types and interfaces.

```ts
// ProviderCapability — what a provider can do
export type ProviderCapability = 'search' | 'enrich' | 'qualify' | 'filter' | 'export' | 'custom';

// RowBatch — chunk of results yielded during execution
export interface RowBatch {
  rows: Record<string, unknown>[];
  batchIndex: number;
  totalSoFar: number;
}

// ExecutionContext — passed into every execute() call
export interface ExecutionContext {
  frameworkContext: string;
  apiKey?: string;
  mcpClient?: unknown;
  batchSize: number;
  totalRequested: number;
}

// ProviderMetadata — lightweight descriptor for UI and planner
export interface ProviderMetadata {
  id: string;
  name: string;
  description: string;
  type: 'builtin' | 'mcp' | 'mock';
  capabilities: ProviderCapability[];
  status: 'active' | 'disconnected' | 'error';
}

// WorkflowStepInput — the step shape from the workflow that providers receive
// Alias this from whatever the workflow step shape is in the codebase.
// At minimum it needs:
export interface WorkflowStepInput {
  stepIndex: number;
  stepType: string;
  provider: string;
  config: Record<string, unknown>;
  [key: string]: unknown;
}

// StepExecutor — the core interface every provider implements
export interface StepExecutor {
  id: string;                   // e.g. 'apollo', 'mcp:firecrawl-server', 'mock'
  name: string;                 // human-readable name
  description: string;          // one-liner for planner context
  type: 'builtin' | 'mcp' | 'mock';
  capabilities: ProviderCapability[];

  canExecute(step: WorkflowStepInput): boolean;
  execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch>;
  getColumnDefinitions(step: WorkflowStepInput): import('../execution/columns').ColumnDef[];
  healthCheck?(): Promise<{ ok: boolean; message: string }>;
}
```

**Notes:**
- Import `ColumnDef` from `src/lib/execution/columns.ts`. If `ColumnDef` is not currently exported, export it.
- `WorkflowStepInput` should align with how the execute route currently destructures step objects. Check the actual shape in the execute route and match it.

---

### `src/lib/providers/registry.ts`

Singleton registry. Module-level instance. Auto-registers `MockProvider` on import.

```ts
import { StepExecutor, ProviderMetadata } from './types';
import { MockProvider } from './builtin/mock-provider';

class ProviderRegistry {
  private providers = new Map<string, StepExecutor>();

  register(executor: StepExecutor): void {
    this.providers.set(executor.id, executor);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  /**
   * Resolve the best executor for a given step.
   * Priority:
   *   1. Exact provider match by id
   *   2. Capability match — prefer MCP > builtin > mock
   */
  resolve(step: { stepType: string; provider: string }): StepExecutor {
    // 1. Exact match
    const exact = this.providers.get(step.provider);
    if (exact) return exact;

    // 2. Capability match — find all that canExecute, sort by type priority
    const typePriority: Record<string, number> = { mcp: 0, builtin: 1, mock: 2 };
    const candidates = Array.from(this.providers.values())
      .filter(p => p.canExecute(step as any))
      .sort((a, b) => (typePriority[a.type] ?? 3) - (typePriority[b.type] ?? 3));

    if (candidates.length > 0) return candidates[0];

    // 3. Fallback to mock if registered
    const mock = this.providers.get('mock');
    if (mock) return mock;

    throw new Error(`No provider found for step type="${step.stepType}" provider="${step.provider}"`);
  }

  getAll(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      type: p.type,
      capabilities: p.capabilities,
      status: 'active' as const,
    }));
  }

  /**
   * Generates the dynamic provider list string injected into
   * the workflow planner's system prompt.
   */
  getAvailableForPlanner(): string {
    const providers = this.getAll();
    if (providers.length === 0) return 'No providers available.';
    return providers
      .map(p => `- ${p.name} (${p.id}): ${p.description} [capabilities: ${p.capabilities.join(', ')}]`)
      .join('\n');
  }
}

// Module-level singleton
const registry = new ProviderRegistry();

// Auto-register mock provider
registry.register(new MockProvider());

export function getRegistry(): ProviderRegistry {
  return registry;
}

export { ProviderRegistry };
```

---

### `src/lib/providers/builtin/mock-provider.ts`

Wraps the existing `mock-engine.ts`. Must NOT duplicate logic — import and delegate.

```ts
import { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../types';
import { generateMockLeads } from '../../execution/mock-engine';
import { /* column maps or buildColumnsFromSteps */ } from '../../execution/columns';

export class MockProvider implements StepExecutor {
  id = 'mock';
  name = 'Mock Provider';
  description = 'Generates realistic mock data via Claude for any step type. Fallback provider.';
  type = 'mock' as const;
  capabilities: ProviderCapability[] = ['search', 'enrich', 'qualify', 'filter', 'export', 'custom'];

  canExecute(_step: WorkflowStepInput): boolean {
    return true; // fallback — can handle anything
  }

  async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
    // Call existing generateMockLeads with the right arguments.
    // Adapt the call signature to match what mock-engine.ts expects.
    // It likely returns rows or streams them — wrap result into RowBatch yields.
    //
    // Example (adapt to actual signature):
    const rows = await generateMockLeads(/* pass step config, context.frameworkContext, context.totalRequested, context.apiKey */);
    yield {
      rows,
      batchIndex: 0,
      totalSoFar: rows.length,
    };
  }

  getColumnDefinitions(step: WorkflowStepInput) {
    // Use existing columns.ts logic to return ColumnDef[] for the step type.
    // Map step.stepType to the right column set.
    // Adapt to actual export names from columns.ts.
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Mock provider ready' };
  }
}
```

**Important:** The `execute()` and `getColumnDefinitions()` method bodies above are pseudocode. Read `mock-engine.ts` and `columns.ts` carefully to determine exact function signatures and adapt the calls. Do NOT change the mock-engine internals — just wrap them.

---

### `src/lib/providers/builtin/index.ts`

Barrel export. Keep it minimal.

```ts
export { MockProvider } from './mock-provider';
// Future: export { ApolloProvider } from './apollo-provider';
// Future: export { HunterProvider } from './hunter-provider';
```

---

## Existing Files to Modify

### `src/lib/ai/types.ts`

**Change:** Replace the hardcoded `WorkflowProvider` union with a dynamic string type.

```ts
// BEFORE (something like):
// export type WorkflowProvider = 'apollo' | 'hunter' | 'clay' | 'mock' | ...;

// AFTER:
export type WorkflowProvider = string;
```

Leave every other type in this file unchanged.

---

### `src/lib/ai/workflow-planner.ts`

**Change:** Replace the static provider list in the system prompt with a dynamic one from the registry.

1. Add import at top:
   ```ts
   import { getRegistry } from '../providers/registry';
   ```

2. Find where the system prompt is built (likely `buildSystemPrompt()` or similar). Locate the hardcoded provider list string.

3. Replace that static string with:
   ```ts
   const providerList = getRegistry().getAvailableForPlanner();
   ```

4. Inject `providerList` into the system prompt where the static list used to be.

Do NOT change the planner's tool definitions, response format, or any other behavior.

---

### `src/app/api/workflows/execute/route.ts`

**Change:** Use the registry to resolve providers instead of calling `generateMockLeads()` directly.

1. Add import:
   ```ts
   import { getRegistry } from '@/lib/providers/registry';
   ```

2. Find the loop/section where steps are executed. For each step:
   ```ts
   const registry = getRegistry();
   const executor = registry.resolve({ stepType: step.stepType, provider: step.provider });
   console.log(`Resolved provider: ${executor.id} for step ${step.stepType}`);
   ```

3. Replace the direct `generateMockLeads()` call with iteration over `executor.execute(step, context)`:
   ```ts
   const context = {
     frameworkContext: /* existing framework context string */,
     apiKey: /* existing API key */,
     batchSize: 10,
     totalRequested: /* from step config */,
   };
   for await (const batch of executor.execute(step, context)) {
     // Use batch.rows exactly where rows were used before
     // Keep all SSE event emissions identical
     // Keep all DB insert operations identical
   }
   ```

4. Keep every SSE event type (`step_start`, `step_progress`, `step_complete`, `workflow_complete`, `error`) unchanged.
5. Keep every DB operation (`resultSets` insert, `resultRows` insert, etc.) unchanged.

---

### `src/lib/execution/mock-engine.ts`

**Change:** Export `checkProviderKey()` if it exists (so registry can use it for health checks). If it does not exist, skip this change.

Also make sure `generateMockLeads()` is exported (it likely already is).

No other changes.

---

### `src/lib/execution/columns.ts`

**Change:** Export the individual column map constants so providers can import them directly.

```ts
// Make sure these are exported (add `export` if they're not):
export const SEARCH_COLUMNS = ...;
export const ENRICH_COLUMNS = ...;
export const QUALIFY_COLUMNS = ...;
// etc.
```

Keep `buildColumnsFromSteps()` exported and unchanged.

Also export the `ColumnDef` type if it is defined here and not already exported.

---

## Verification Steps

Run these checks in order. Every one must pass before committing.

1. **`pnpm dev`** — app starts without errors on http://localhost:3000
2. **End-to-end flow:** Open the app -> start a chat -> describe a workflow (e.g. "Find 20 SaaS companies") -> approve the proposed workflow -> execution runs and generates mock leads in the results table. Behavior must be identical to before this change.
3. **Console log:** During execution, the browser console or server terminal must show `Resolved provider: mock` for each step.
4. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: dynamic provider registry with StepExecutor interface (4.1)
```
