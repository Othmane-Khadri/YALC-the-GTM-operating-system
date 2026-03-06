# Sub-Brief 4.10 — Provider Intelligence

**What you're building:** The OS tracks provider performance (accuracy, latency, cost, coverage) per segment and actively selects the BEST provider for each task — not just the first available.

**Read these files first:**
1. `src/lib/providers/registry.ts` — ProviderRegistry (from 4.1)
2. `src/lib/providers/types.ts` — StepExecutor (from 4.1)
3. `src/lib/intelligence/store.ts` — IntelligenceStore (from 4.5)
4. `src/lib/signals/collector.ts` — SignalCollector (from 4.9)
5. `src/lib/db/schema.ts` — current tables
6. `docs/SYSTEMS_ARCHITECTURE.md` — Provider Intelligence section

---

## New files

### `src/lib/providers/intelligence.ts`

**ProviderIntelligence** class:

- `recordExecution(providerId: string, step: { stepType: string }, result: { rowCount: number, latencyMs: number, costEstimate: number, qualityScore?: number }, segment?: string): Promise<void>`
  — Records a provider execution stat to `provider_stats` table

- `getBestProvider(request: { stepType: string, capabilities: string[], segment?: string, budgetLimit?: number, preferQuality?: boolean }): Promise<{ providerId: string, reason: string, estimatedCost: number, alternatives: { providerId: string, reason: string }[] }>`
  — Decision matrix: reads `provider_stats`, `provider_preferences`, intelligence. Returns best provider with reasoning.

- `getStats(providerId: string, segment?: string): Promise<ProviderStats>`

- `setPreference(skillId: string, segment: string | null, providerId: string, reason: string, source: 'auto' | 'user'): Promise<void>`

---

### `src/lib/providers/stats.ts`

```ts
ProviderStats interface:
  providerId: string
  metrics: {
    accuracy: number
    avgLatencyMs: number
    avgCostPerCall: number
    coverageScore: number
    sampleSize: number
  }
  segment: string | null

aggregateStats(providerId: string, segment?: string): Promise<ProviderStats>
  // queries provider_stats table, aggregates across executions
```

---

## Existing files to modify

### `src/lib/db/schema.ts`

Add two tables:

**`provider_stats`**

| Column     | Type            | Constraints          |
|------------|-----------------|----------------------|
| id         | text (uuid)     | PK                   |
| providerId | text            | not null             |
| metric     | text            | not null (`'accuracy' \| 'latency_ms' \| 'cost_per_call' \| 'coverage'`) |
| value      | real            | not null             |
| sampleSize | integer         | default 1            |
| segment    | text            | nullable             |
| measuredAt | timestamp       | default now          |

**`provider_preferences`**

| Column            | Type            | Constraints          |
|-------------------|-----------------|----------------------|
| id                | text (uuid)     | PK                   |
| skillId           | text            | not null             |
| segment           | text            | nullable             |
| preferredProvider | text            | not null             |
| reason            | text            |                      |
| source            | text            | default `'auto'` (`'auto' \| 'user' \| 'intelligence'`) |
| createdAt         | timestamp       | default now          |

---

### `src/lib/providers/registry.ts`

Update `resolve()` method:

- Instead of simple priority (MCP > builtin > mock), call `ProviderIntelligence.getBestProvider()` first.
- If it returns a result, use that.
- Fallback to the simple priority if no stats exist yet.

---

### `src/app/api/workflows/execute/route.ts` (or wherever skills execute)

After each step execution:

```ts
await providerIntelligence.recordExecution(providerId, { stepType }, {
  rowCount: result.rows.length,
  latencyMs: endTime - startTime,
  costEstimate: estimatedCost,
  qualityScore: qualityScore ?? undefined,
}, segment)
```

Emit signal:

```ts
await getCollector().emit({
  type: 'provider_performance',
  data: { providerId, stepType, metrics: { rowCount, latencyMs, costEstimate } },
})
```

---

### `src/lib/signals/collector.ts`

Ensure `'provider_performance'` is in `SignalType` (should already be from 4.9).

---

## Verify

1. Execute a workflow → `provider_stats` table gets entries for the mock provider
2. Execute again → stats accumulate (`sampleSize` increases)
3. `registry.resolve()` now calls `ProviderIntelligence` (falls back to mock since it's the only provider)
4. When MCP providers are connected: they get stats too, and the system can choose between them
5. `pnpm build` clean

---

**Commit:** `feat: provider intelligence with performance tracking + smart selection (4.10)`
