# Sub-Brief 4.12 — Data Quality Monitor

**What you're building:** A system that ensures lead data stays accurate, deduplicated, and fresh. Nudges the human with specific recommendations when action is needed.

**Read these files first:**
1. `src/lib/db/schema.ts` — resultSets, resultRows
2. `src/lib/review/queue.ts` — ReviewQueue (from 4.6)
3. `src/lib/signals/collector.ts` — SignalCollector (from 4.9)
4. `src/lib/providers/registry.ts` — ProviderRegistry
5. `docs/SYSTEMS_ARCHITECTURE.md` — Data Quality section

---

## New files

### `src/lib/data-quality/types.ts`

```ts
QualityCheckType: 'duplicate' | 'email_decay' | 'completeness' | 'anomaly' | 'freshness' | 'cross_campaign_overlap'

QualitySeverity: 'info' | 'warning' | 'critical'

QualityIssue interface:
  id: string
  resultSetId: string
  rowId: string | null
  checkType: QualityCheckType
  severity: QualitySeverity
  details: Record<string, unknown>
  nudge: string
  action: {
    endpoint: string
    method: string
    body: unknown
  } | null
  resolved: boolean
  createdAt: string
```

---

### `src/lib/data-quality/monitor.ts`

**DataQualityMonitor** class:

- `checkDedup(resultSetId: string): Promise<QualityIssue[]>`
  - Fuzzy match on `company_name` + website domain across ALL resultSets
  - Matching: normalize company name (lowercase, strip Inc/Ltd/GmbH etc), extract domain from website URL
  - If duplicate found: create issue with nudge:
    > "Found [N] duplicates from [other resultSet name]. Merge and use most recent data? [Yes / Show me]"

- `checkCompleteness(resultSetId: string): Promise<QualityIssue[]>`
  - For each row: count non-null, non-empty columns / total columns
  - If <60%: flag as `warning`. If <40%: flag as `critical`.
  - Nudge:
    > "[N] rows are missing [key fields]. Enrich with [provider]? Estimated cost: $[X] [Yes / No]"

- `checkAnomaly(resultSetId: string, icpMatchRate: number): Promise<QualityIssue[]>`
  - If `icpMatchRate` < 15%: critical anomaly
  - Nudge:
    > "ICP match rate is [X]% (usually [Y]%). Search criteria may be too broad. [View analysis]"

- `checkFreshness(resultSetId: string): Promise<QualityIssue[]>`
  - Check `resultSet.createdAt` age
  - \>30 days: `warning`. >60 days: `critical`.
  - Nudge:
    > "Data is [N] days old. Re-enrich to get current information? [Yes / Skip]"

- `runAll(resultSetId: string): Promise<QualityIssue[]>`
  - Runs all checks, returns combined issues
  - For critical issues: creates `ReviewRequest` via `ReviewQueue`

---

### `src/app/api/data-quality/check/route.ts`

- **POST**: `{ resultSetId }` → runs all checks, returns issues
- Creates `ReviewRequest` entries for critical issues

---

### `src/app/api/data-quality/issues/route.ts`

- **GET**: list all unresolved issues across all resultSets
- **PATCH**: resolve an issue (mark as resolved)

---

## Existing files to modify

### `src/lib/db/schema.ts`

Add `data_quality_log` table:

| Column      | Type               | Constraints          |
|-------------|--------------------|----------------------|
| id          | text (uuid)        | PK                   |
| resultSetId | text               | not null             |
| rowId       | text               | nullable             |
| checkType   | text               | not null             |
| severity    | text               | not null             |
| details     | text (JSON)        |                      |
| nudge       | text               |                      |
| action      | text (JSON)        | nullable             |
| resolved    | integer (boolean)  | default false        |
| resolvedAt  | timestamp          | nullable             |
| createdAt   | timestamp          | default now          |

---

### `src/app/api/workflows/execute/route.ts`

After execution completes:

```ts
// Fire and forget — don't block the response
DataQualityMonitor.runAll(resultSetId).catch(err =>
  console.error('Data quality check failed:', err)
)
```

Log issues but don't block the response.

---

### `src/components/table/TableHeader.tsx`

- If there are unresolved quality issues for this table: show a quality badge
  - `tangerine` for warnings
  - `pomegranate` for critical
- Click badge → shows issues inline or links to `/reviews`

---

## Verify

1. Execute a workflow → creates resultSet with 50 rows
2. `POST /api/data-quality/check` → runs all checks
3. Completeness check flags rows missing key fields
4. Execute another workflow with similar query → dedup check finds overlapping companies
5. Critical issues appear in `/reviews`
6. Table header shows quality badge
7. `pnpm build` clean

---

**Commit:** `feat: data quality monitor with nudge-based hygiene (4.12)`
