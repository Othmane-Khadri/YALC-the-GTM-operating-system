# Sub-Brief 4.5 — Intelligence System

**Goal:** Replace the flat `framework.learnings[]` array with a structured intelligence system. Intelligence is categorized, evidence-backed, bias-checked, and confidence-scored. Every system produces and consumes intelligence.

---

## Read These Files First

Read every file listed below before writing any code. Understand the current shapes, imports, and patterns.

1. `src/lib/framework/types.ts` — current `Learning` type (we are extending)
2. `src/lib/framework/context.ts` — `buildFrameworkContext()` (we are evolving)
3. `src/lib/db/schema.ts` — current tables
4. `src/lib/execution/learning-extractor.ts` — RLHF extraction
5. `src/app/api/tables/[id]/learn/confirm/route.ts` — where learnings are saved
6. `docs/SYSTEMS_ARCHITECTURE.md` — Intelligence section

---

## New Files to Create

### `src/lib/intelligence/types.ts`

All intelligence-system types. No runtime logic, only types and interfaces.

```ts
// IntelligenceCategory — the domain this intelligence applies to
export type IntelligenceCategory =
  | 'icp'
  | 'channel'
  | 'content'
  | 'timing'
  | 'provider'
  | 'qualification'
  | 'campaign'
  | 'competitive';

// IntelligenceSource — how this intelligence was produced
export type IntelligenceSource =
  | 'rlhf'
  | 'campaign_outcome'
  | 'ab_test'
  | 'implicit'
  | 'external'
  | 'human_input'
  | 'correction';

// ConfidenceLevel — lifecycle stage of an intelligence entry
export type ConfidenceLevel = 'hypothesis' | 'validated' | 'proven';

// Evidence — a single supporting data point
export interface Evidence {
  type: string;             // e.g. 'lead_outcome', 'campaign_metric', 'user_feedback'
  sourceId: string;         // ID of the originating entity (result set, campaign, etc.)
  metric: string;           // what was measured, e.g. 'reply_rate', 'qualification_accuracy'
  value: number;            // the measured value
  sampleSize: number;       // how many observations this evidence is based on
  timestamp: string;        // ISO-8601
}

// BiasCheck — validation that the intelligence isn't skewed
export interface BiasCheck {
  sampleSize: number;       // total observations across all evidence
  segmentBalance: boolean;  // true if evidence spans multiple segments
  timeSpan: number;         // days between earliest and latest evidence
  recencyWeighted: boolean; // true if recent evidence was weighted higher
  checkedAt: string;        // ISO-8601
}

// Intelligence — the core entity
export interface Intelligence {
  id: string;
  category: IntelligenceCategory;
  insight: string;                         // specific, actionable conclusion
  evidence: Evidence[];
  segment: string | null;                  // ICP segment this applies to, or null = global
  channel: string | null;                  // channel this applies to, or null = all
  confidence: ConfidenceLevel;
  confidenceScore: number;                 // 0-100, computed from evidence + bias check
  source: IntelligenceSource;
  biasCheck: BiasCheck | null;
  supersedes: string | null;               // ID of the intelligence this replaces
  createdAt: string;                       // ISO-8601
  validatedAt: string | null;              // ISO-8601
  expiresAt: string | null;               // ISO-8601
}
```

---

### `src/lib/intelligence/confidence.ts`

Pure functions for confidence scoring and lifecycle decisions.

```ts
import type { Intelligence, BiasCheck } from './types';

/**
 * Confidence score formula (max 100):
 *   evidence_count * 10  (capped at 40)
 * + time_span_days        (capped at 30)
 * + bias_check_passed * 30
 * = max 100
 */
export function calculateConfidenceScore(intelligence: Intelligence): number {
  const evidenceScore = Math.min(intelligence.evidence.length * 10, 40);

  // Time span: days between earliest and latest evidence
  let timeSpanScore = 0;
  if (intelligence.evidence.length >= 2) {
    const timestamps = intelligence.evidence.map(e => new Date(e.timestamp).getTime());
    const spanMs = Math.max(...timestamps) - Math.min(...timestamps);
    const spanDays = spanMs / (1000 * 60 * 60 * 24);
    timeSpanScore = Math.min(Math.round(spanDays), 30);
  }

  const biasScore = intelligence.biasCheck
    && intelligence.biasCheck.sampleSize >= 30
    && intelligence.biasCheck.segmentBalance
    && intelligence.biasCheck.timeSpan >= 14
    ? 30
    : 0;

  return Math.min(evidenceScore + timeSpanScore + biasScore, 100);
}

/**
 * Determine if an intelligence entry should be promoted to the next confidence level.
 *
 * hypothesis -> validated: needs at least 2 evidence entries
 * validated  -> proven:    needs a passing bias check
 */
export function shouldPromote(
  intelligence: Intelligence
): { shouldPromote: boolean; reason: string } {
  if (intelligence.confidence === 'hypothesis') {
    if (intelligence.evidence.length >= 2) {
      return { shouldPromote: true, reason: 'Has 2+ evidence entries — ready for validated' };
    }
    return { shouldPromote: false, reason: `Only ${intelligence.evidence.length} evidence entry (need 2+)` };
  }

  if (intelligence.confidence === 'validated') {
    if (
      intelligence.biasCheck
      && intelligence.biasCheck.sampleSize >= 30
      && intelligence.biasCheck.segmentBalance
      && intelligence.biasCheck.timeSpan >= 14
    ) {
      return { shouldPromote: true, reason: 'Bias check passed — ready for proven' };
    }
    return {
      shouldPromote: false,
      reason: intelligence.biasCheck
        ? `Bias check incomplete: sample=${intelligence.biasCheck.sampleSize}, balanced=${intelligence.biasCheck.segmentBalance}, span=${intelligence.biasCheck.timeSpan}d`
        : 'No bias check performed yet',
    };
  }

  // Already proven
  return { shouldPromote: false, reason: 'Already at highest confidence level' };
}

/**
 * Check if an intelligence entry has expired.
 */
export function isExpired(intelligence: Intelligence): boolean {
  if (!intelligence.expiresAt) return false;
  return new Date(intelligence.expiresAt).getTime() < Date.now();
}
```

---

### `src/lib/intelligence/store.ts`

The `IntelligenceStore` class. All reads/writes go through Drizzle ORM against the `intelligence` table.

```ts
import { randomUUID } from 'crypto';
import { eq, and, gte, desc, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db';
import { intelligence as intelligenceTable } from '../db/schema';
import type {
  Intelligence,
  IntelligenceCategory,
  IntelligenceSource,
  ConfidenceLevel,
  BiasCheck,
} from './types';
import { calculateConfidenceScore, shouldPromote as checkShouldPromote } from './confidence';

type CreateInput = Omit<Intelligence, 'id' | 'createdAt' | 'confidenceScore'>;

interface QueryFilters {
  category?: IntelligenceCategory;
  segment?: string;
  channel?: string;
  minConfidence?: ConfidenceLevel;
  source?: IntelligenceSource;
}

export class IntelligenceStore {
  /**
   * Add a new intelligence entry. Computes confidenceScore automatically.
   */
  async add(input: CreateInput): Promise<Intelligence> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    // Build a temporary Intelligence object for scoring
    const entry: Intelligence = {
      ...input,
      id,
      createdAt,
      confidenceScore: 0,
    };
    entry.confidenceScore = calculateConfidenceScore(entry);

    await db.insert(intelligenceTable).values({
      id,
      category: entry.category,
      insight: entry.insight,
      evidence: JSON.stringify(entry.evidence),
      segment: entry.segment,
      channel: entry.channel,
      confidence: entry.confidence,
      confidenceScore: entry.confidenceScore,
      source: entry.source,
      biasCheck: entry.biasCheck ? JSON.stringify(entry.biasCheck) : null,
      supersedes: entry.supersedes,
      createdAt,
      validatedAt: entry.validatedAt,
      expiresAt: entry.expiresAt,
    });

    return entry;
  }

  /**
   * Retrieve a single intelligence entry by ID.
   */
  async get(id: string): Promise<Intelligence | null> {
    const rows = await db
      .select()
      .from(intelligenceTable)
      .where(eq(intelligenceTable.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return this.deserialize(rows[0]);
  }

  /**
   * Query intelligence with optional filters.
   */
  async query(filters: QueryFilters): Promise<Intelligence[]> {
    // Build conditions array dynamically
    const conditions = [];

    if (filters.category) {
      conditions.push(eq(intelligenceTable.category, filters.category));
    }
    if (filters.segment) {
      conditions.push(eq(intelligenceTable.segment, filters.segment));
    }
    if (filters.channel) {
      conditions.push(eq(intelligenceTable.channel, filters.channel));
    }
    if (filters.minConfidence) {
      const levels: ConfidenceLevel[] = ['hypothesis', 'validated', 'proven'];
      const minIndex = levels.indexOf(filters.minConfidence);
      const allowed = levels.slice(minIndex);
      conditions.push(inArray(intelligenceTable.confidence, allowed));
    }
    if (filters.source) {
      conditions.push(eq(intelligenceTable.source, filters.source));
    }

    const rows = await db
      .select()
      .from(intelligenceTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(intelligenceTable.confidenceScore));

    return rows.map(r => this.deserialize(r));
  }

  /**
   * Get intelligence formatted for prompt injection.
   * Returns top 5 proven + top 3 validated relevant to the given segment.
   * NEVER returns hypotheses.
   */
  async getForPrompt(segment?: string): Promise<Intelligence[]> {
    const segmentCondition = segment
      ? or(eq(intelligenceTable.segment, segment), isNull(intelligenceTable.segment))
      : undefined;

    // Fetch proven (up to 5)
    const provenRows = await db
      .select()
      .from(intelligenceTable)
      .where(
        and(
          eq(intelligenceTable.confidence, 'proven'),
          segmentCondition,
        )
      )
      .orderBy(desc(intelligenceTable.confidenceScore))
      .limit(5);

    // Fetch validated (up to 3)
    const validatedRows = await db
      .select()
      .from(intelligenceTable)
      .where(
        and(
          eq(intelligenceTable.confidence, 'validated'),
          segmentCondition,
        )
      )
      .orderBy(desc(intelligenceTable.confidenceScore))
      .limit(3);

    return [...provenRows, ...validatedRows].map(r => this.deserialize(r));
  }

  /**
   * Recalculate the confidence score for an intelligence entry from its evidence.
   */
  async updateConfidence(id: string): Promise<void> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Intelligence ${id} not found`);

    const newScore = calculateConfidenceScore(entry);
    await db
      .update(intelligenceTable)
      .set({ confidenceScore: newScore })
      .where(eq(intelligenceTable.id, id));
  }

  /**
   * Mark an old intelligence entry as superseded by a new one.
   */
  async supersede(oldId: string, newIntelligence: CreateInput): Promise<Intelligence> {
    // Mark old entry with expiry
    await db
      .update(intelligenceTable)
      .set({ expiresAt: new Date().toISOString() })
      .where(eq(intelligenceTable.id, oldId));

    // Create new entry referencing the old one
    return this.add({ ...newIntelligence, supersedes: oldId });
  }

  /**
   * Expire an intelligence entry immediately.
   */
  async expire(id: string): Promise<void> {
    await db
      .update(intelligenceTable)
      .set({ expiresAt: new Date().toISOString() })
      .where(eq(intelligenceTable.id, id));
  }

  /**
   * Run a bias check on an intelligence entry.
   * Validates: sample > 30, multi-segment, time span > 14 days.
   */
  async checkBias(id: string): Promise<BiasCheck> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Intelligence ${id} not found`);

    const totalSample = entry.evidence.reduce((sum, e) => sum + e.sampleSize, 0);
    const timestamps = entry.evidence.map(e => new Date(e.timestamp).getTime());
    const timeSpan = timestamps.length >= 2
      ? Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24))
      : 0;

    // Check if evidence spans multiple source IDs (proxy for segment balance)
    const uniqueSources = new Set(entry.evidence.map(e => e.sourceId));
    const segmentBalance = uniqueSources.size >= 2;

    const biasCheck: BiasCheck = {
      sampleSize: totalSample,
      segmentBalance,
      timeSpan,
      recencyWeighted: false,
      checkedAt: new Date().toISOString(),
    };

    // Persist the bias check
    await db
      .update(intelligenceTable)
      .set({ biasCheck: JSON.stringify(biasCheck) })
      .where(eq(intelligenceTable.id, id));

    return biasCheck;
  }

  /**
   * Promote intelligence to the next confidence level.
   * hypothesis -> validated: needs evidence
   * validated  -> proven: needs passing bias check
   */
  async promote(id: string): Promise<Intelligence> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Intelligence ${id} not found`);

    const { shouldPromote: canPromote, reason } = checkShouldPromote(entry);
    if (!canPromote) throw new Error(`Cannot promote: ${reason}`);

    const nextLevel: Record<string, ConfidenceLevel> = {
      hypothesis: 'validated',
      validated: 'proven',
    };

    const newConfidence = nextLevel[entry.confidence];
    if (!newConfidence) throw new Error('Already at highest confidence level');

    const now = new Date().toISOString();
    await db
      .update(intelligenceTable)
      .set({
        confidence: newConfidence,
        validatedAt: newConfidence === 'validated' || newConfidence === 'proven' ? now : entry.validatedAt,
      })
      .where(eq(intelligenceTable.id, id));

    return { ...entry, confidence: newConfidence, validatedAt: now };
  }

  // ---- private helpers ----

  private deserialize(row: any): Intelligence {
    return {
      id: row.id,
      category: row.category,
      insight: row.insight,
      evidence: typeof row.evidence === 'string' ? JSON.parse(row.evidence) : row.evidence,
      segment: row.segment,
      channel: row.channel,
      confidence: row.confidence,
      confidenceScore: row.confidenceScore,
      source: row.source,
      biasCheck: row.biasCheck
        ? typeof row.biasCheck === 'string' ? JSON.parse(row.biasCheck) : row.biasCheck
        : null,
      supersedes: row.supersedes,
      createdAt: row.createdAt,
      validatedAt: row.validatedAt,
      expiresAt: row.expiresAt,
    };
  }
}
```

---

## Existing Files to Modify

### `src/lib/db/schema.ts`

**Add** the `intelligence` table:

```ts
export const intelligence = sqliteTable('intelligence', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),           // IntelligenceCategory
  insight: text('insight').notNull(),
  evidence: text('evidence').notNull(),            // JSON: Evidence[]
  segment: text('segment'),
  channel: text('channel'),
  confidence: text('confidence').notNull().default('hypothesis'),
  confidenceScore: integer('confidence_score').default(0),
  source: text('source').notNull(),                // IntelligenceSource
  biasCheck: text('bias_check'),                   // JSON: BiasCheck | null
  supersedes: text('supersedes'),                  // FK to intelligence.id (soft ref)
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  validatedAt: text('validated_at'),
  expiresAt: text('expires_at'),
});
```

Add standalone relations:

```ts
export const intelligenceRelations = relations(intelligence, () => ({}));
```

---

### `src/lib/framework/context.ts`

**Change:** Update `buildFrameworkContext()` to inject structured intelligence instead of flat learnings.

1. Add import at top:
   ```ts
   import { IntelligenceStore } from '../intelligence/store';
   ```

2. Find where `framework.learnings` is serialized into the prompt context string.

3. Replace the flat serialization with:
   ```ts
   const store = new IntelligenceStore();
   const entries = await store.getForPrompt(primarySegment);

   const intelligenceBlock = entries.length > 0
     ? entries.map(entry => {
         const timeSpan = entry.evidence.length >= 2
           ? Math.round(
               (Math.max(...entry.evidence.map(e => new Date(e.timestamp).getTime()))
                - Math.min(...entry.evidence.map(e => new Date(e.timestamp).getTime())))
               / (1000 * 60 * 60 * 24)
             )
           : 0;

         return [
           `[${entry.confidence.toUpperCase()}] [${entry.category}]`,
           entry.insight,
           `Based on ${entry.evidence.length} data points across ${timeSpan} days`,
         ].join('\n');
       }).join('\n\n')
     : 'No validated intelligence yet.';
   ```

4. Inject `intelligenceBlock` where the flat learnings string used to go.

5. If `buildFrameworkContext()` is not already async, make it async and update all callers.

**Important:** Keep backward compatibility. If `framework.learnings` still has data, migrate it at read time by including a note: `(legacy learnings below — not yet structured)`.

---

### `src/lib/framework/types.ts`

**Change:** Keep the existing `Learning` type for backward compatibility. Add re-export of `Intelligence`:

```ts
// Keep existing Learning type untouched

// Re-export from intelligence system
export type { Intelligence } from '../intelligence/types';
```

---

### `src/app/api/tables/[id]/learn/confirm/route.ts`

**Change:** Instead of appending to `framework.learnings[]`, create Intelligence entries.

1. Add imports:
   ```ts
   import { IntelligenceStore } from '@/lib/intelligence/store';
   import type { IntelligenceCategory, Evidence } from '@/lib/intelligence/types';
   ```

2. Find where confirmed patterns are saved to `framework.learnings`.

3. Replace with:
   ```ts
   const store = new IntelligenceStore();

   for (const pattern of confirmedPatterns) {
     const evidence: Evidence = {
       type: 'lead_outcome',
       sourceId: resultSetId,        // the table/result set this came from
       metric: 'qualification_accuracy',
       value: pattern.confidence ?? 0.7,
       sampleSize: approvedCount + rejectedCount,
       timestamp: new Date().toISOString(),
     };

     await store.add({
       category: (pattern.category as IntelligenceCategory) ?? 'qualification',
       insight: pattern.pattern,       // the specific conclusion
       evidence: [evidence],
       segment: pattern.segment ?? null,
       channel: null,
       confidence: 'hypothesis',
       source: 'rlhf',
       biasCheck: null,
       supersedes: null,
       validatedAt: null,
       expiresAt: null,
     });
   }
   ```

4. Keep any existing logic that updates the framework object — just stop writing to the `learnings` array for new entries.

---

### `src/lib/execution/learning-extractor.ts`

**Change:** Update `ExtractedPattern` and the Claude prompt.

1. Add a `category` field to `ExtractedPattern`:
   ```ts
   export interface ExtractedPattern {
     pattern: string;
     confidence: number;
     segment?: string;
     category?: 'icp' | 'channel' | 'content' | 'timing' | 'provider' | 'qualification' | 'campaign' | 'competitive';
   }
   ```

2. Update the Claude prompt that extracts patterns. Add this instruction:
   ```
   For each pattern, also include a "category" field with one of:
   icp, channel, content, timing, provider, qualification, campaign, competitive.
   Choose the category that best describes what domain this learning applies to.
   ```

---

## Verification Steps

Run these checks in order. Every one must pass before committing.

1. **RLHF flow:** Open a table with results -> click "Learn" -> approve/reject leads -> click "Done Reviewing" -> patterns are saved as Intelligence entries in the DB (not flat `framework.learnings`).
2. **Query intelligence:** Check the intelligence table has rows with `confidence='hypothesis'`, `source='rlhf'`, `category` populated.
3. **Prompt injection:** Start a new chat. The `buildFrameworkContext()` output should include proven/validated intelligence with evidence counts. Hypotheses must NOT appear.
4. **Threshold enforcement:** Intelligence with fewer than 30 total sample size stays as hypothesis — never injected into prompts.
5. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: structured intelligence system with evidence + confidence (4.5)
```
