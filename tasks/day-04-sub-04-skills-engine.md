# Sub-Brief 4.4 — Skills Engine

**Goal:** Replace the placeholder skills system with a real Skills Engine. Every recurring GTM task is a Skill — standardized, composable, provider-agnostic. The workflow planner sees skills as the higher-level abstraction and prefers them over raw provider steps.

**Depends on:** Sub-Briefs 4.1, 4.2, and 4.3 must be completed first. The provider registry must exist and be operational.

---

## Read These Files First

1. `src/lib/skills/types.ts` — current placeholder (you are rewriting this entirely)
2. `src/lib/skills/registry.ts` — current placeholder (you are rewriting this entirely)
3. `src/lib/providers/types.ts` — `StepExecutor`, `ProviderCapability`, `RowBatch`, `ExecutionContext` (from 4.1)
4. `src/lib/providers/registry.ts` — `ProviderRegistry`, `getRegistry()` (from 4.1)
5. `src/lib/execution/mock-engine.ts` — how data generation works
6. `src/lib/execution/columns.ts` — column definitions, `ColumnDef` type
7. `src/lib/ai/workflow-planner.ts` — current planner system prompt (you are adding skills to it)
8. `src/lib/framework/types.ts` — `GTMFramework`, `Learning` types
9. `src/lib/db/schema.ts` — `resultSets`, `resultRows` tables (skills need to read result data)

---

## Files to Rewrite (Replace Placeholder Contents Entirely)

### `src/lib/skills/types.ts`

Delete all existing placeholder content. Replace with:

```ts
import { ProviderRegistry } from '../providers/registry';

// ---------------------------------------------------------------------------
// Skill event types — yielded during execution
// ---------------------------------------------------------------------------

export type SkillEvent =
  | { type: 'progress'; message: string; percent: number }
  | { type: 'result'; data: unknown }
  | { type: 'approval_needed'; title: string; description: string; payload: unknown }
  | { type: 'signal'; signalType: string; data: unknown }
  | { type: 'error'; message: string };

// ---------------------------------------------------------------------------
// Skill context — passed into every skill's execute()
// ---------------------------------------------------------------------------

export interface SkillContext {
  framework: import('../framework/types').GTMFramework;   // user's GTM framework
  intelligence: unknown[];                                  // accumulated learnings
  providers: ProviderRegistry;                              // access to all providers
  userId: string;                                           // current user
}

// ---------------------------------------------------------------------------
// Skill interface — the core contract
// ---------------------------------------------------------------------------

export type SkillCategory = 'research' | 'content' | 'outreach' | 'analysis' | 'data' | 'integration';

export interface Skill {
  id: string;
  name: string;
  version: string;          // semver, e.g. '1.0.0'
  description: string;
  category: SkillCategory;
  inputSchema: Record<string, unknown>;    // JSON Schema
  outputSchema: Record<string, unknown>;   // JSON Schema
  requiredCapabilities: string[];          // provider capabilities needed ([] for none)
  estimatedCost?: (input: unknown) => number;
  execute: (input: unknown, context: SkillContext) => AsyncIterable<SkillEvent>;
}

// ---------------------------------------------------------------------------
// Skill metadata — lightweight version for planner and UI
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  category: SkillCategory;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}
```

---

### `src/lib/skills/registry.ts`

Delete all existing placeholder content. Replace with:

```ts
import { Skill, SkillMetadata, SkillCategory } from './types';

// Import built-in skills (registered below)
import { findCompaniesSkill } from './builtin/find-companies';
import { enrichLeadsSkill } from './builtin/enrich-leads';
import { qualifyLeadsSkill } from './builtin/qualify-leads';
import { exportDataSkill } from './builtin/export-data';

class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): void {
    this.skills.delete(id);
  }

  get(id: string): Skill | null {
    return this.skills.get(id) ?? null;
  }

  list(category?: SkillCategory): SkillMetadata[] {
    const all = Array.from(this.skills.values());
    const filtered = category ? all.filter(s => s.category === category) : all;
    return filtered.map(s => ({
      id: s.id,
      name: s.name,
      version: s.version,
      description: s.description,
      category: s.category,
      inputSchema: s.inputSchema,
      outputSchema: s.outputSchema,
    }));
  }

  /**
   * Generates a skill list string for the workflow planner's system prompt.
   * Format: skill id, name, description, category, required capabilities.
   */
  getForPlanner(): string {
    const skills = this.list();
    if (skills.length === 0) return 'No skills available.';
    return skills
      .map(s => `- ${s.name} (${s.id}): ${s.description} [category: ${s.category}]`)
      .join('\n');
  }
}

// Module-level singleton
const skillRegistry = new SkillRegistry();

// Auto-register built-in skills
skillRegistry.register(findCompaniesSkill);
skillRegistry.register(enrichLeadsSkill);
skillRegistry.register(qualifyLeadsSkill);
skillRegistry.register(exportDataSkill);

export function getSkillRegistry(): SkillRegistry {
  return skillRegistry;
}

export { SkillRegistry };
```

---

## New Files to Create

### `src/lib/skills/builtin/find-companies.ts`

The "Find Companies" skill. Resolves a search-capable provider and delegates execution.

```ts
import { Skill, SkillEvent, SkillContext } from '../types';

export const findCompaniesSkill: Skill = {
  id: 'find-companies',
  name: 'Find Companies',
  version: '1.0.0',
  description: 'Search for companies matching specific criteria (industry, size, location, stage). Uses the best available search provider.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      count: { type: 'number', description: 'Number of companies to find', default: 10 },
      filters: {
        type: 'object',
        properties: {
          industry: { type: 'string' },
          employeeRange: { type: 'string' },
          location: { type: 'string' },
          stage: { type: 'string' },
        },
      },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: { type: 'object' },
      },
      totalFound: { type: 'number' },
    },
  },
  requiredCapabilities: ['search'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { query, count = 10, filters = {} } = input as {
      query: string;
      count?: number;
      filters?: Record<string, unknown>;
    };

    yield { type: 'progress', message: 'Resolving search provider...', percent: 5 };

    // Resolve the best search-capable provider
    const provider = context.providers.resolve({ stepType: 'search', provider: 'mock' });

    yield { type: 'progress', message: `Using provider: ${provider.name}`, percent: 10 };

    const step = {
      stepIndex: 0,
      stepType: 'search',
      provider: provider.id,
      config: { query, count, ...filters },
    };

    const executionContext = {
      frameworkContext: '', // Could be built from context.framework
      batchSize: count,
      totalRequested: count,
    };

    yield { type: 'progress', message: `Searching for ${count} companies...`, percent: 20 };

    let totalRows = 0;
    for await (const batch of provider.execute(step, executionContext)) {
      totalRows += batch.rows.length;
      const percent = Math.min(20 + (totalRows / count) * 70, 90);
      yield { type: 'progress', message: `Found ${totalRows} companies...`, percent };
      yield { type: 'result', data: { companies: batch.rows, batchIndex: batch.batchIndex } };
    }

    yield { type: 'progress', message: `Search complete. ${totalRows} companies found.`, percent: 100 };
  },
};
```

---

### `src/lib/skills/builtin/enrich-leads.ts`

The "Enrich Leads" skill. Loads rows from a result set and enriches them.

```ts
import { Skill, SkillEvent, SkillContext } from '../types';
import { db } from '../../db';           // Drizzle DB instance
import { resultRows } from '../../db/schema';
import { eq } from 'drizzle-orm';

export const enrichLeadsSkill: Skill = {
  id: 'enrich-leads',
  name: 'Enrich Leads',
  version: '1.0.0',
  description: 'Enrich an existing result set with additional data (contact info, tech stack, email verification). Requires a result set ID from a previous search.',
  category: 'data',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to enrich' },
      enrichmentType: {
        type: 'string',
        enum: ['contact', 'tech_stack', 'email_verify'],
        description: 'Type of enrichment to perform',
      },
    },
    required: ['resultSetId', 'enrichmentType'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      enrichedRows: { type: 'array', items: { type: 'object' } },
      enrichedCount: { type: 'number' },
    },
  },
  requiredCapabilities: ['enrich'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, enrichmentType } = input as {
      resultSetId: string;
      enrichmentType: 'contact' | 'tech_stack' | 'email_verify';
    };

    yield { type: 'progress', message: 'Loading result set...', percent: 5 };

    // Load existing rows from the result set
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId));

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` };
      return;
    }

    yield { type: 'progress', message: `Found ${rows.length} rows. Resolving enrichment provider...`, percent: 10 };

    // Resolve an enrich-capable provider
    const provider = context.providers.resolve({ stepType: 'enrich', provider: 'mock' });

    yield { type: 'progress', message: `Enriching with ${provider.name} (${enrichmentType})...`, percent: 15 };

    const step = {
      stepIndex: 0,
      stepType: 'enrich',
      provider: provider.id,
      config: {
        resultSetId,
        enrichmentType,
        rowCount: rows.length,
      },
    };

    const executionContext = {
      frameworkContext: '',
      batchSize: rows.length,
      totalRequested: rows.length,
    };

    let enrichedCount = 0;
    for await (const batch of provider.execute(step, executionContext)) {
      enrichedCount += batch.rows.length;
      const percent = Math.min(15 + (enrichedCount / rows.length) * 80, 95);
      yield { type: 'progress', message: `Enriched ${enrichedCount}/${rows.length} rows...`, percent };
      yield { type: 'result', data: { enrichedRows: batch.rows, batchIndex: batch.batchIndex } };
    }

    yield { type: 'progress', message: `Enrichment complete. ${enrichedCount} rows enriched.`, percent: 100 };
  },
};
```

**Note:** The DB import paths (`db`, `resultRows`, `eq`) must match the project's actual exports. Check `src/lib/db/schema.ts` and `src/lib/db/index.ts` for exact export names.

---

### `src/lib/skills/builtin/qualify-leads.ts`

The "Qualify Leads" skill. Scores leads against the user's ICP.

```ts
import { Skill, SkillEvent, SkillContext } from '../types';
import { db } from '../../db';
import { resultRows } from '../../db/schema';
import { eq } from 'drizzle-orm';

export const qualifyLeadsSkill: Skill = {
  id: 'qualify-leads',
  name: 'Qualify Leads',
  version: '1.0.0',
  description: 'Score and qualify leads in a result set against your ICP framework and accumulated learnings. Each lead gets a qualification score and reason.',
  category: 'analysis',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to qualify' },
      segment: { type: 'string', description: 'Optional: specific ICP segment to qualify against' },
    },
    required: ['resultSetId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      qualifiedRows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            reason: { type: 'string' },
            originalData: { type: 'object' },
          },
        },
      },
      summary: {
        type: 'object',
        properties: {
          totalQualified: { type: 'number' },
          averageScore: { type: 'number' },
          highScoreCount: { type: 'number' },
        },
      },
    },
  },
  requiredCapabilities: ['qualify'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, segment } = input as {
      resultSetId: string;
      segment?: string;
    };

    yield { type: 'progress', message: 'Loading result set for qualification...', percent: 5 };

    // Load rows
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId));

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` };
      return;
    }

    yield { type: 'progress', message: `Qualifying ${rows.length} leads...`, percent: 10 };

    // Resolve qualify-capable provider
    const provider = context.providers.resolve({ stepType: 'qualify', provider: 'mock' });

    const step = {
      stepIndex: 0,
      stepType: 'qualify',
      provider: provider.id,
      config: {
        resultSetId,
        segment,
        rowCount: rows.length,
      },
    };

    const executionContext = {
      frameworkContext: '', // Could build from context.framework
      batchSize: rows.length,
      totalRequested: rows.length,
    };

    let qualifiedCount = 0;
    const allQualified: unknown[] = [];

    for await (const batch of provider.execute(step, executionContext)) {
      qualifiedCount += batch.rows.length;
      allQualified.push(...batch.rows);
      const percent = Math.min(10 + (qualifiedCount / rows.length) * 80, 90);
      yield { type: 'progress', message: `Qualified ${qualifiedCount}/${rows.length} leads...`, percent };
      yield { type: 'result', data: { qualifiedRows: batch.rows, batchIndex: batch.batchIndex } };
    }

    // Compute summary
    const scores = allQualified.map((r: any) => r.qualificationScore ?? r.score ?? 50);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const highScoreCount = scores.filter(s => s >= 70).length;

    yield {
      type: 'signal',
      signalType: 'qualification_complete',
      data: {
        totalQualified: qualifiedCount,
        averageScore: Math.round(averageScore),
        highScoreCount,
      },
    };

    yield { type: 'progress', message: `Qualification complete. ${highScoreCount} high-score leads.`, percent: 100 };
  },
};
```

---

### `src/lib/skills/builtin/export-data.ts`

The "Export Data" skill. Formats result set data as CSV or JSON for download.

```ts
import { Skill, SkillEvent, SkillContext } from '../types';
import { db } from '../../db';
import { resultRows, resultSets } from '../../db/schema';
import { eq } from 'drizzle-orm';

export const exportDataSkill: Skill = {
  id: 'export-data',
  name: 'Export Data',
  version: '1.0.0',
  description: 'Export a result set as CSV or JSON. No external provider needed — reads directly from GTM-OS data.',
  category: 'data',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to export' },
      format: {
        type: 'string',
        enum: ['csv', 'json'],
        description: 'Export format',
        default: 'csv',
      },
    },
    required: ['resultSetId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string' },
      content: { type: 'string' },
      rowCount: { type: 'number' },
    },
  },
  requiredCapabilities: [], // No provider needed

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, format = 'csv' } = input as {
      resultSetId: string;
      format?: 'csv' | 'json';
    };

    yield { type: 'progress', message: 'Loading result set...', percent: 10 };

    // Load rows
    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId));

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` };
      return;
    }

    yield { type: 'progress', message: `Formatting ${rows.length} rows as ${format.toUpperCase()}...`, percent: 40 };

    // Parse the row data — resultRows likely stores data as a JSON text column
    const parsedRows = rows.map((row: any) => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? row);
      return data;
    });

    let content: string;

    if (format === 'json') {
      content = JSON.stringify(parsedRows, null, 2);
    } else {
      // CSV
      if (parsedRows.length === 0) {
        content = '';
      } else {
        const headers = Object.keys(parsedRows[0]);
        const csvRows = [
          headers.join(','),
          ...parsedRows.map(row =>
            headers
              .map(h => {
                const val = String(row[h] ?? '');
                // Escape commas and quotes in CSV
                return val.includes(',') || val.includes('"') || val.includes('\n')
                  ? `"${val.replace(/"/g, '""')}"`
                  : val;
              })
              .join(',')
          ),
        ];
        content = csvRows.join('\n');
      }
    }

    yield { type: 'progress', message: 'Export ready.', percent: 90 };

    yield {
      type: 'result',
      data: {
        format,
        content,
        rowCount: parsedRows.length,
      },
    };

    yield { type: 'progress', message: `Exported ${parsedRows.length} rows as ${format.toUpperCase()}.`, percent: 100 };
  },
};
```

---

### `src/lib/skills/builtin/index.ts`

Barrel file that imports and re-exports all built-in skills. The registry imports from here.

```ts
export { findCompaniesSkill } from './find-companies';
export { enrichLeadsSkill } from './enrich-leads';
export { qualifyLeadsSkill } from './qualify-leads';
export { exportDataSkill } from './export-data';
```

---

## Existing Files to Modify

### `src/lib/ai/workflow-planner.ts`

Add the skills section to the system prompt so the planner knows about available skills.

1. Add import at top:
   ```ts
   import { getSkillRegistry } from '../skills/registry';
   ```

2. Find the function that builds the system prompt (same one modified in 4.1 for providers). Locate the section where provider information is injected.

3. Add a skills section **after** the providers section:
   ```ts
   const skillList = getSkillRegistry().getForPlanner();
   ```

4. Inject into the system prompt. The prompt should include something like:
   ```
   ## Available Skills
   Skills are high-level, reusable GTM operations. Prefer using skills over raw provider steps when a skill matches the user's intent.

   ${skillList}
   ```

5. Do NOT change any tool definitions, response format, or proposal flow. The planner still uses `propose_workflow`. Skills are informational context in the prompt — they help the planner make better step choices but do not change the proposal structure.

---

## Verification Steps

Run these in order. Every one must pass.

1. **`pnpm dev`** — app starts without errors.
2. **Skill registry populated** — add a temporary `console.log(getSkillRegistry().list())` in `workflow-planner.ts` or a page component. Should output 4 skills:
   - `find-companies` (research)
   - `enrich-leads` (data)
   - `qualify-leads` (analysis)
   - `export-data` (data)
3. **Planner system prompt updated** — add a temporary `console.log` in the planner to print the system prompt. Confirm it includes:
   ```
   Available Skills:
   - Find Companies (find-companies): Search for companies matching specific criteria... [category: research]
   - Enrich Leads (enrich-leads): Enrich an existing result set... [category: data]
   - Qualify Leads (qualify-leads): Score and qualify leads... [category: analysis]
   - Export Data (export-data): Export a result set as CSV or JSON... [category: data]
   ```
4. **End-to-end flow unchanged** — open the app, start a chat, type "Find 50 SaaS companies in France", approve the proposed workflow, execution runs and generates mock leads. The behavior is identical to before. Skills are in the prompt but the planner still proposes the same kind of workflow steps.
5. **Remove temporary console.logs** before committing.
6. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: skills engine with built-in GTM skills (4.4)
```
