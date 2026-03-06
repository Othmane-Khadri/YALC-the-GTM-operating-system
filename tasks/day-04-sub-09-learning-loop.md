# Sub-Brief 4.9 — Continuous Learning Loop

**What you're building:** A passive signal collection system that accumulates intelligence from every user interaction — not just explicit RLHF sessions. Signals are collected, patterns are detected by Claude in batch, and new intelligence entries are created automatically.

**Read these files first:**
1. `src/lib/intelligence/types.ts` — Intelligence, Evidence types (from 4.5)
2. `src/lib/intelligence/store.ts` — IntelligenceStore (from 4.5)
3. `src/lib/review/queue.ts` — ReviewQueue (from 4.6)
4. `src/lib/db/schema.ts` — current tables
5. `src/lib/ai/client.ts` — Anthropic client
6. `docs/SYSTEMS_ARCHITECTURE.md` — Learning Loop section

---

## New files

### `src/lib/signals/types.ts`

```ts
SignalType: 'rlhf_feedback' | 'workflow_edit' | 'export_selection' | 'chat_correction' | 'search_refinement' | 'rerun' | 'campaign_outcome' | 'provider_performance' | 'human_review_decision' | 'ab_test_result'

Signal interface:
  id: string
  type: SignalType
  category: string              // maps to IntelligenceCategory
  data: Record<string, unknown>
  conversationId?: string
  resultSetId?: string
  campaignId?: string
  createdAt: string
```

---

### `src/lib/signals/collector.ts`

**SignalCollector** class (singleton):

- `emit(signal: Omit<Signal, 'id' | 'createdAt'>): Promise<void>` — writes to `signals_log` table
- `getRecent(since: Date, category?: string): Promise<Signal[]>`
- `getCount(since: Date): Promise<number>`
- `getCollector(): SignalCollector` — module-level export

---

### `src/lib/signals/detector.ts`

**PatternDetector** class:

- `detect(signals: Signal[], existingIntelligence: Intelligence[]): Promise<DetectedPattern[]>`
- Uses Claude (Sonnet) to analyze signals grouped by category
- Claude prompt: receives signals as structured data + existing intelligence, returns new patterns or confidence upgrades
- Tool definition:
  ```
  extract_patterns → { patterns: DetectedPattern[] }
  ```
- `DetectedPattern` shape:
  ```ts
  {
    insight: string
    category: IntelligenceCategory
    segment?: string
    channel?: string
    evidence: Evidence[]
    suggestedConfidence: number
    isUpgrade: boolean
    upgradeTargetId?: string
  }
  ```

---

### `src/lib/signals/scheduler.ts`

`runPatternDetection()`: async function

1. Load signals from last 24 hours via `SignalCollector.getRecent()`
2. Load existing intelligence via `IntelligenceStore`
3. Call `PatternDetector.detect()`
4. For each pattern:
   - If `isUpgrade`: update existing intelligence confidence via `IntelligenceStore.updateConfidence()`
   - If new hypothesis: save via `IntelligenceStore.add()` with `auto_derived` flag
   - If high confidence (>60): create `ReviewRequest` via `ReviewQueue` for human confirmation
5. Returns summary: `{ newHypotheses: number, upgrades: number, pendingReviews: number }`

---

### `src/app/api/signals/detect/route.ts`

- **POST**: manually trigger pattern detection (for testing + on-demand)
- Returns: `{ newHypotheses, upgrades, pendingReviews }`

---

### `src/app/api/signals/route.ts`

- **GET**: list recent signals with filters (`type`, `category`, `since`)
- Returns: signal count + recent signals array

---

## Existing files to modify

### `src/lib/db/schema.ts`

Add `signals_log` table:

| Column         | Type                | Constraints          |
|----------------|---------------------|----------------------|
| id             | text (uuid)         | PK                   |
| type           | text                | not null             |
| category       | text                | not null             |
| data           | text (JSON)         | not null             |
| conversationId | text                | nullable             |
| resultSetId    | text                | nullable             |
| campaignId     | text                | nullable             |
| createdAt      | timestamp           | default now          |

---

### `src/app/api/tables/[id]/rows/[rowId]/feedback/route.ts`

After saving feedback, emit signal via `SignalCollector`:

```ts
await getCollector().emit({
  type: 'rlhf_feedback',
  category: 'qualification',
  data: { rowId, feedback, rowData: /* summary */, resultSetId },
})
```

---

### `src/app/api/chat/route.ts`

After saving assistant message, if the user's message looks like a correction ("no, I meant...", "actually...", "not that, ..."):

```ts
await getCollector().emit({
  type: 'chat_correction',
  category: 'qualification',
  data: { userMessage, previousAssistantMessage },
})
```

Simple heuristic: check if message starts with correction keywords.

---

### `src/lib/review/queue.ts`

When a review is approved/rejected, emit signal:

```ts
await getCollector().emit({
  type: 'human_review_decision',
  category: /* based on review type */,
  data: { reviewId, type, decision, notes },
})
```

---

### `src/lib/campaign/manager.ts`

When a campaign step completes, emit signal:

```ts
await getCollector().emit({
  type: 'campaign_outcome',
  category: 'campaign',
  data: { campaignId, stepId, skillId, outcomeMetrics },
})
```

---

## Verify

1. Approve/reject some table rows → `GET /api/signals` shows `rlhf_feedback` signals
2. `POST /api/signals/detect` → Claude analyzes signals, returns detected patterns
3. If patterns found → check Intelligence store has new hypotheses
4. If high-confidence pattern → check `/reviews` has a confirmation request
5. `pnpm build` clean

---

**Commit:** `feat: continuous learning loop with signal collection + pattern detection (4.9)`
