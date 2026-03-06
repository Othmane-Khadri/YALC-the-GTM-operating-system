# Sub-Brief 4.6 — Human Review + Nudge System

**Goal:** Build a unified review queue for all human-in-the-loop interactions. Approval gates, nudges, escalations — all through one system. Every review item shows what happened, why it matters, what to do, and a one-click action.

---

## Read These Files First

Read every file listed below before writing any code. Understand the current shapes, imports, and patterns.

1. `src/lib/db/schema.ts` — current tables
2. `src/components/layout/Sidebar.tsx` — nav items (icon SVGs, accent colors, badge pattern)
3. `src/components/table/LearningsPanel.tsx` — existing review pattern (UI + data flow)
4. `src/app/tables/[id]/page.tsx` — page layout pattern (JotaiProvider > Sidebar > view)
5. `docs/SYSTEMS_ARCHITECTURE.md` — Human Review section

---

## New Files to Create

### `src/lib/review/types.ts`

All review-system types. No runtime logic, only types and interfaces.

```ts
// ReviewType — what kind of human decision is needed
export type ReviewType =
  | 'content_review'
  | 'campaign_gate'
  | 'nudge'
  | 'intelligence'
  | 'data_quality'
  | 'anomaly'
  | 'escalation'
  | 'snapshot_request';

// ReviewPriority — urgency of the review item
export type ReviewPriority = 'low' | 'normal' | 'high' | 'urgent';

// ReviewStatus — lifecycle state
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'dismissed' | 'expired';

// ReviewAction — the one-click action that fires on approval
export interface ReviewAction {
  endpoint: string;            // API route to call
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body: unknown;               // payload sent to the endpoint
}

// NudgeEvidence — data supporting a nudge recommendation
export interface NudgeEvidence {
  metrics: { name: string; current: number; projected: number }[];
  reasoning: string;
  alternatives: {
    title: string;
    action: ReviewAction;
  }[];
  showDataEndpoint: string | null;   // API route to fetch detailed data for display
}

// ReviewRequest — the core entity
export interface ReviewRequest {
  id: string;
  type: ReviewType;
  title: string;               // one-line summary
  description: string;         // full context (markdown supported)
  sourceSystem: string;        // 'campaign_manager' | 'learning_loop' | 'optimization' | 'data_monitor' | 'execution'
  sourceId: string;            // ID of the entity that spawned this review
  priority: ReviewPriority;
  status: ReviewStatus;
  payload: Record<string, unknown>;   // type-specific data
  action: ReviewAction | null;        // one-click action (fires on approve)
  nudgeEvidence: NudgeEvidence | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  expiresAt: string | null;
  createdAt: string;
}
```

---

### `src/lib/review/queue.ts`

The `ReviewQueue` class. Reads/writes via Drizzle ORM against the `review_queue` table.

```ts
import { randomUUID } from 'crypto';
import { eq, and, desc, lt } from 'drizzle-orm';
import { db } from '../db';
import { reviewQueue } from '../db/schema';
import type { ReviewRequest, ReviewStatus, ReviewType, ReviewPriority } from './types';

type CreateInput = Omit<ReviewRequest, 'id' | 'status' | 'createdAt'>;

interface ListFilters {
  status?: ReviewStatus;
  type?: ReviewType;
  priority?: ReviewPriority;
  sourceSystem?: string;
}

export class ReviewQueue {
  /**
   * Create a new review request.
   */
  async create(input: CreateInput): Promise<ReviewRequest> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();

    const entry: ReviewRequest = {
      ...input,
      id,
      status: 'pending',
      createdAt,
    };

    await db.insert(reviewQueue).values({
      id,
      type: entry.type,
      title: entry.title,
      description: entry.description,
      sourceSystem: entry.sourceSystem,
      sourceId: entry.sourceId,
      priority: entry.priority,
      status: 'pending',
      payload: JSON.stringify(entry.payload),
      action: entry.action ? JSON.stringify(entry.action) : null,
      nudgeEvidence: entry.nudgeEvidence ? JSON.stringify(entry.nudgeEvidence) : null,
      reviewedAt: null,
      reviewNotes: null,
      expiresAt: entry.expiresAt,
      createdAt,
    });

    return entry;
  }

  /**
   * Get a single review request by ID.
   */
  async get(id: string): Promise<ReviewRequest | null> {
    const rows = await db
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.id, id))
      .limit(1);

    if (rows.length === 0) return null;
    return this.deserialize(rows[0]);
  }

  /**
   * List review requests with optional filters.
   * Default order: priority desc (urgent first), then createdAt asc (oldest first).
   */
  async list(filters: ListFilters = {}): Promise<ReviewRequest[]> {
    const conditions = [];

    if (filters.status) {
      conditions.push(eq(reviewQueue.status, filters.status));
    }
    if (filters.type) {
      conditions.push(eq(reviewQueue.type, filters.type));
    }
    if (filters.priority) {
      conditions.push(eq(reviewQueue.priority, filters.priority));
    }
    if (filters.sourceSystem) {
      conditions.push(eq(reviewQueue.sourceSystem, filters.sourceSystem));
    }

    const rows = await db
      .select()
      .from(reviewQueue)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        // Priority: urgent=0, high=1, normal=2, low=3 (sort ascending = urgent first)
        // Then oldest pending first
        desc(reviewQueue.createdAt)
      );

    // Sort in JS for priority ordering (SQLite text sort won't match our enum)
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    const results = rows.map(r => this.deserialize(r));
    results.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 4;
      const pb = priorityOrder[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    return results;
  }

  /**
   * Get counts of pending reviews by priority.
   */
  async getPendingCount(): Promise<{ total: number; urgent: number; high: number }> {
    const pending = await this.list({ status: 'pending' });
    return {
      total: pending.length,
      urgent: pending.filter(r => r.priority === 'urgent').length,
      high: pending.filter(r => r.priority === 'high').length,
    };
  }

  /**
   * Approve a review request.
   * If the request has an action defined, fire it automatically.
   */
  async approve(id: string, notes?: string): Promise<ReviewRequest> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Review ${id} not found`);

    const now = new Date().toISOString();

    await db
      .update(reviewQueue)
      .set({
        status: 'approved',
        reviewedAt: now,
        reviewNotes: notes ?? null,
      })
      .where(eq(reviewQueue.id, id));

    // Fire the one-click action if defined
    if (entry.action) {
      try {
        await fetch(entry.action.endpoint, {
          method: entry.action.method,
          headers: { 'Content-Type': 'application/json' },
          body: entry.action.body ? JSON.stringify(entry.action.body) : undefined,
        });
      } catch (err) {
        console.error(`[ReviewQueue] Failed to execute action for review ${id}:`, err);
      }
    }

    return { ...entry, status: 'approved', reviewedAt: now, reviewNotes: notes ?? null };
  }

  /**
   * Reject a review request.
   */
  async reject(id: string, notes?: string): Promise<ReviewRequest> {
    const entry = await this.get(id);
    if (!entry) throw new Error(`Review ${id} not found`);

    const now = new Date().toISOString();

    await db
      .update(reviewQueue)
      .set({
        status: 'rejected',
        reviewedAt: now,
        reviewNotes: notes ?? null,
      })
      .where(eq(reviewQueue.id, id));

    return { ...entry, status: 'rejected', reviewedAt: now, reviewNotes: notes ?? null };
  }

  /**
   * Dismiss a review request (not approve, not reject — just clear it).
   */
  async dismiss(id: string): Promise<void> {
    await db
      .update(reviewQueue)
      .set({
        status: 'dismissed',
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(reviewQueue.id, id));
  }

  /**
   * Expire all review requests that are past their expiresAt timestamp.
   * Returns the count of expired items.
   */
  async expireOld(): Promise<number> {
    const now = new Date().toISOString();
    const expired = await db
      .select()
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.status, 'pending'),
          lt(reviewQueue.expiresAt, now)
        )
      );

    if (expired.length === 0) return 0;

    for (const row of expired) {
      await db
        .update(reviewQueue)
        .set({ status: 'expired', reviewedAt: now })
        .where(eq(reviewQueue.id, row.id));
    }

    return expired.length;
  }

  // ---- private helpers ----

  private deserialize(row: any): ReviewRequest {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      sourceSystem: row.sourceSystem,
      sourceId: row.sourceId,
      priority: row.priority,
      status: row.status,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}),
      action: row.action
        ? typeof row.action === 'string' ? JSON.parse(row.action) : row.action
        : null,
      nudgeEvidence: row.nudgeEvidence
        ? typeof row.nudgeEvidence === 'string' ? JSON.parse(row.nudgeEvidence) : row.nudgeEvidence
        : null,
      reviewedAt: row.reviewedAt,
      reviewNotes: row.reviewNotes,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }
}
```

---

### `src/app/api/reviews/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ReviewQueue } from '@/lib/review/queue';

const queue = new ReviewQueue();

// GET /api/reviews — list reviews with optional filters
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as any;
  const type = searchParams.get('type') as any;
  const priority = searchParams.get('priority') as any;
  const sourceSystem = searchParams.get('sourceSystem') ?? undefined;

  const reviews = await queue.list({
    status: status || 'pending',
    type: type || undefined,
    priority: priority || undefined,
    sourceSystem,
  });

  return NextResponse.json(reviews);
}

// POST /api/reviews — create a new review request
export async function POST(req: NextRequest) {
  const body = await req.json();
  const review = await queue.create(body);
  return NextResponse.json(review, { status: 201 });
}
```

---

### `src/app/api/reviews/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { ReviewQueue } from '@/lib/review/queue';

const queue = new ReviewQueue();

// GET /api/reviews/:id — single review details
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const review = await queue.get(params.id);
  if (!review) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }
  return NextResponse.json(review);
}

// PATCH /api/reviews/:id — approve, reject, or dismiss
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();
  const { status, notes } = body as {
    status: 'approved' | 'rejected' | 'dismissed';
    notes?: string;
  };

  try {
    let result;
    switch (status) {
      case 'approved':
        result = await queue.approve(params.id, notes);
        break;
      case 'rejected':
        result = await queue.reject(params.id, notes);
        break;
      case 'dismissed':
        await queue.dismiss(params.id);
        result = { id: params.id, status: 'dismissed' };
        break;
      default:
        return NextResponse.json({ error: `Invalid status: ${status}` }, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
}
```

---

### `src/app/reviews/page.tsx`

Follow the same layout pattern used in other pages (JotaiProvider > Sidebar > view component).

```tsx
import { JotaiProvider } from '@/components/providers/JotaiProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { ReviewsView } from '@/components/reviews/ReviewsView';

export default function ReviewsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="reviews" />
        <main className="flex-1 overflow-hidden">
          <ReviewsView />
        </main>
      </div>
    </JotaiProvider>
  );
}
```

---

### `src/components/reviews/ReviewsView.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { reviewsAtom, reviewsLoadingAtom, reviewFilterAtom } from '@/atoms/reviews';
import { ReviewCard } from './ReviewCard';
import type { ReviewStatus } from '@/lib/review/types';
import { cn } from '@/lib/utils';

const STATUS_TABS: { label: string; value: ReviewStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

export function ReviewsView() {
  const [reviews, setReviews] = useAtom(reviewsAtom);
  const [loading, setLoading] = useAtom(reviewsLoadingAtom);
  const [filter, setFilter] = useAtom(reviewFilterAtom);

  useEffect(() => {
    async function fetchReviews() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter.status !== 'all') params.set('status', filter.status);
        if (filter.priority !== 'all') params.set('priority', filter.priority);

        const res = await fetch(`/api/reviews?${params.toString()}`);
        const data = await res.json();
        setReviews(data);
      } finally {
        setLoading(false);
      }
    }
    fetchReviews();
  }, [filter, setReviews, setLoading]);

  const pendingCount = reviews.filter(r => r.status === 'pending').length;

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-mono">Reviews</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Human-in-the-loop review queue for approvals, nudges, and escalations.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(prev => ({ ...prev, status: tab.value }))}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filter.status === tab.value
                ? 'bg-blueberry text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {tab.label}
            {tab.value === 'pending' && pendingCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-tangerine text-white">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Review list */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading reviews...</div>
        ) : reviews.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg font-mono">Nothing to review right now</p>
            <p className="text-sm mt-1">Review items from campaigns, intelligence, and data quality checks will appear here.</p>
          </div>
        ) : (
          reviews.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              onUpdate={(updated) => {
                setReviews(prev =>
                  prev.map(r => (r.id === updated.id ? updated : r))
                );
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}
```

---

### `src/components/reviews/ReviewCard.tsx`

```tsx
'use client';

import { useState } from 'react';
import type { ReviewRequest } from '@/lib/review/types';
import { cn } from '@/lib/utils';

const PRIORITY_BORDER: Record<string, string> = {
  urgent: 'border-l-pomegranate',
  high: 'border-l-tangerine',
  normal: 'border-l-blueberry',
  low: 'border-l-border',
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-pomegranate text-white',
  high: 'bg-tangerine text-white',
  normal: 'bg-blueberry text-white',
  low: 'bg-muted text-muted-foreground',
};

interface ReviewCardProps {
  review: ReviewRequest;
  onUpdate: (updated: ReviewRequest) => void;
}

export function ReviewCard({ review, onUpdate }: ReviewCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState('');
  const [acting, setActing] = useState(false);

  const isPending = review.status === 'pending';

  async function handleAction(status: 'approved' | 'rejected' | 'dismissed') {
    setActing(true);
    try {
      const res = await fetch(`/api/reviews/${review.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, notes: notes || undefined }),
      });
      const updated = await res.json();
      onUpdate({ ...review, ...updated });
    } finally {
      setActing(false);
    }
  }

  return (
    <div
      className={cn(
        'border-l-4 rounded-md border bg-card p-4',
        PRIORITY_BORDER[review.priority] ?? 'border-l-border'
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium text-sm truncate">{review.title}</h3>
            <span className={cn('text-xs px-1.5 py-0.5 rounded-full', PRIORITY_BADGE[review.priority])}>
              {review.priority}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
              {review.sourceSystem}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {new Date(review.createdAt).toLocaleString()}
          </p>
        </div>

        {/* Status badge for resolved items */}
        {!isPending && (
          <span className={cn(
            'text-xs px-2 py-1 rounded-full font-medium',
            review.status === 'approved' && 'bg-matcha/20 text-matcha',
            review.status === 'rejected' && 'bg-pomegranate/20 text-pomegranate',
            review.status === 'dismissed' && 'bg-muted text-muted-foreground',
            review.status === 'expired' && 'bg-muted text-muted-foreground',
          )}>
            {review.status}
          </span>
        )}
      </div>

      {/* Description (expandable) */}
      <div className="mt-2">
        <p className={cn('text-sm text-muted-foreground', !expanded && 'line-clamp-2')}>
          {review.description}
        </p>
        {review.description.length > 200 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blueberry hover:underline mt-1"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Nudge evidence (only for nudge type) */}
      {review.type === 'nudge' && review.nudgeEvidence && (
        <div className="mt-3 p-3 rounded bg-muted/50 text-sm space-y-2">
          <p className="font-medium text-xs uppercase tracking-wider text-muted-foreground">Nudge Evidence</p>
          <div className="space-y-1">
            {review.nudgeEvidence.metrics.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-mono">{m.name}:</span>
                <span>{m.current}</span>
                <span className="text-muted-foreground">-></span>
                <span className={m.projected > m.current ? 'text-matcha' : 'text-pomegranate'}>
                  {m.projected}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{review.nudgeEvidence.reasoning}</p>
          {review.nudgeEvidence.alternatives.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Alternatives:</p>
              {review.nudgeEvidence.alternatives.map((alt, i) => (
                <button
                  key={i}
                  onClick={() => handleAction('approved')}
                  className="text-xs text-blueberry hover:underline"
                >
                  {alt.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions (only for pending) */}
      {isPending && (
        <div className="mt-3 space-y-2">
          {expanded && (
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add review notes (optional)..."
              className="w-full px-3 py-1.5 text-sm rounded border bg-background input-focus"
            />
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleAction('approved')}
              disabled={acting}
              className="px-3 py-1.5 text-sm font-medium rounded bg-matcha text-white hover:bg-matcha/90 disabled:opacity-50"
            >
              {acting ? '...' : 'Approve'}
            </button>
            <button
              onClick={() => handleAction('rejected')}
              disabled={acting}
              className="px-3 py-1.5 text-sm font-medium rounded bg-pomegranate text-white hover:bg-pomegranate/90 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              onClick={() => handleAction('dismissed')}
              disabled={acting}
              className="px-3 py-1.5 text-sm font-medium rounded text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Dismiss
            </button>
            {!expanded && (
              <button
                onClick={() => setExpanded(true)}
                className="ml-auto text-xs text-blueberry hover:underline"
              >
                Add notes
              </button>
            )}
          </div>
        </div>
      )}

      {/* Review notes (shown on resolved items) */}
      {review.reviewNotes && !isPending && (
        <p className="mt-2 text-xs text-muted-foreground italic">
          Note: {review.reviewNotes}
        </p>
      )}
    </div>
  );
}
```

---

### `src/atoms/reviews.ts`

```ts
import { atom } from 'jotai';
import type { ReviewRequest, ReviewStatus, ReviewPriority } from '@/lib/review/types';

export const reviewsAtom = atom<ReviewRequest[]>([]);
export const reviewsLoadingAtom = atom(false);

export const reviewFilterAtom = atom<{
  status: ReviewStatus | 'all';
  priority: ReviewPriority | 'all';
}>({
  status: 'pending',
  priority: 'all',
});

// Derived: pending counts by priority
export const pendingCountAtom = atom((get) => {
  const reviews = get(reviewsAtom);
  const pending = reviews.filter(r => r.status === 'pending');
  return {
    total: pending.length,
    urgent: pending.filter(r => r.priority === 'urgent').length,
    high: pending.filter(r => r.priority === 'high').length,
    normal: pending.filter(r => r.priority === 'normal').length,
    low: pending.filter(r => r.priority === 'low').length,
  };
});
```

---

## Existing Files to Modify

### `src/lib/db/schema.ts`

**Add** the `review_queue` table:

```ts
export const reviewQueue = sqliteTable('review_queue', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),                    // ReviewType
  title: text('title').notNull(),
  description: text('description').notNull(),
  sourceSystem: text('source_system').notNull(),
  sourceId: text('source_id').notNull(),
  priority: text('priority').notNull().default('normal'),
  status: text('status').notNull().default('pending'),
  payload: text('payload').notNull(),              // JSON: Record<string, unknown>
  action: text('action'),                          // JSON: ReviewAction | null
  nudgeEvidence: text('nudge_evidence'),           // JSON: NudgeEvidence | null
  reviewedAt: text('reviewed_at'),
  reviewNotes: text('review_notes'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});
```

**Add** the `notification_preferences` table (for future notification routing):

```ts
export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),              // 'in_app' | 'email' | 'slack' | 'webhook'
  config: text('config').notNull(),                // JSON: channel-specific config
  minPriority: text('min_priority').notNull().default('normal'),
  enabled: integer('enabled').notNull().default(1),
});
```

Add standalone relations for both:

```ts
export const reviewQueueRelations = relations(reviewQueue, () => ({}));
export const notificationPreferencesRelations = relations(notificationPreferences, () => ({}));
```

---

### `src/components/layout/Sidebar.tsx`

**Add** a "Reviews" nav item. Place it between "Tables" and "Knowledge Base" (match the existing nav item structure).

1. Find the nav items array/config.

2. Add this entry at the correct position:
   ```ts
   {
     id: 'reviews',
     label: 'Reviews',
     href: '/reviews',
     icon: /* bell SVG, 16x16, match existing icon style */,
     accent: 'tangerine',
     comingSoon: false,
   }
   ```

3. **Badge:** The Reviews nav item should show a badge with the pending count when it is greater than 0. Use the `pendingCountAtom` from `@/atoms/reviews` to read the count. Only show the badge when `total > 0`. Style: small tangerine circle with white text, positioned top-right of the icon.

   If the Sidebar is a server component, convert the badge portion to a client sub-component that reads the atom:
   ```tsx
   // ReviewsBadge — small client component for the Sidebar
   'use client';
   import { useAtomValue } from 'jotai';
   import { pendingCountAtom } from '@/atoms/reviews';

   export function ReviewsBadge() {
     const counts = useAtomValue(pendingCountAtom);
     if (counts.total === 0) return null;
     return (
       <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold rounded-full bg-tangerine text-white px-1">
         {counts.total}
       </span>
     );
   }
   ```

4. The bell icon SVG (16x16):
   ```tsx
   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
     <path d="M8 1.5C5.5 1.5 4 3.5 4 5.5V8L3 10H13L12 8V5.5C12 3.5 10.5 1.5 8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
     <path d="M6.5 10V11C6.5 11.83 7.17 12.5 8 12.5C8.83 12.5 9.5 11.83 9.5 11V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
   </svg>
   ```

---

## Verification Steps

Run these checks in order. Every one must pass before committing.

1. **Navigate to /reviews** — page renders with empty state message "Nothing to review right now".
2. **Create a review:** `POST /api/reviews` with body:
   ```json
   {
     "type": "campaign_gate",
     "title": "Approve French SaaS campaign step 2",
     "description": "The find-companies skill returned 48 leads. Review before enrichment step runs.",
     "sourceSystem": "campaign_manager",
     "sourceId": "campaign-001",
     "priority": "high",
     "payload": { "leadCount": 48 },
     "action": { "endpoint": "/api/campaigns/001/steps/2/execute", "method": "POST", "body": {} },
     "nudgeEvidence": null,
     "expiresAt": null
   }
   ```
   Verify: review card appears in the Pending tab with orange left border (high priority).
3. **Approve:** Click Approve on the card. Status changes to "approved". Card moves to the Approved tab.
4. **Sidebar badge:** When pending reviews exist, the Reviews nav item shows a tangerine badge with the count. When all are resolved, the badge disappears.
5. **Priority colors:** Create reviews at all 4 priority levels. Verify: urgent = pomegranate border, high = tangerine, normal = blueberry, low = default border.
6. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: human review queue with nudge support (4.6)
```
