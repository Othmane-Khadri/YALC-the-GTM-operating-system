import { randomUUID } from 'crypto'
import { eq, and, desc, lt } from 'drizzle-orm'
import { db } from '../db'
import { reviewQueue } from '../db/schema'
import type { ReviewRequest, ReviewStatus, ReviewType, ReviewPriority } from './types'
import { getCollector } from '../signals/collector'

type CreateInput = Omit<ReviewRequest, 'id' | 'status' | 'createdAt'>

interface ListFilters {
  status?: ReviewStatus
  type?: ReviewType
  priority?: ReviewPriority
  sourceSystem?: string
}

export class ReviewQueue {
  async create(input: CreateInput): Promise<ReviewRequest> {
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    const entry: ReviewRequest = {
      ...input,
      id,
      status: 'pending',
      createdAt,
    }

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
    })

    return entry
  }

  async get(id: string): Promise<ReviewRequest | null> {
    const rows = await db
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.id, id))
      .limit(1)

    if (rows.length === 0) return null
    return this.deserialize(rows[0])
  }

  async list(filters: ListFilters = {}): Promise<ReviewRequest[]> {
    const conditions = []

    if (filters.status) {
      conditions.push(eq(reviewQueue.status, filters.status))
    }
    if (filters.type) {
      conditions.push(eq(reviewQueue.type, filters.type))
    }
    if (filters.priority) {
      conditions.push(eq(reviewQueue.priority, filters.priority))
    }
    if (filters.sourceSystem) {
      conditions.push(eq(reviewQueue.sourceSystem, filters.sourceSystem))
    }

    const rows = await db
      .select()
      .from(reviewQueue)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reviewQueue.createdAt))

    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
    const results = rows.map(r => this.deserialize(r))
    results.sort((a, b) => {
      const pa = priorityOrder[a.priority] ?? 4
      const pb = priorityOrder[b.priority] ?? 4
      if (pa !== pb) return pa - pb
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })

    return results
  }

  async getPendingCount(): Promise<{ total: number; urgent: number; high: number }> {
    const pending = await this.list({ status: 'pending' })
    return {
      total: pending.length,
      urgent: pending.filter(r => r.priority === 'urgent').length,
      high: pending.filter(r => r.priority === 'high').length,
    }
  }

  async approve(id: string, notes?: string): Promise<ReviewRequest> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Review ${id} not found`)

    const now = new Date().toISOString()

    await db
      .update(reviewQueue)
      .set({
        status: 'approved',
        reviewedAt: now,
        reviewNotes: notes ?? null,
      })
      .where(eq(reviewQueue.id, id))

    if (entry.action) {
      try {
        await fetch(entry.action.endpoint, {
          method: entry.action.method,
          headers: { 'Content-Type': 'application/json' },
          body: entry.action.body ? JSON.stringify(entry.action.body) : undefined,
        })
      } catch (err) {
        console.error(`[ReviewQueue] Failed to execute action for review ${id}:`, err)
      }
    }

    // Emit review decision signal
    await getCollector().emit({
      type: 'human_review_decision',
      category: this.reviewTypeToCategory(entry.type),
      data: { reviewId: id, type: entry.type, decision: 'approved', notes },
    })

    return { ...entry, status: 'approved', reviewedAt: now, reviewNotes: notes ?? null }
  }

  async reject(id: string, notes?: string): Promise<ReviewRequest> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Review ${id} not found`)

    const now = new Date().toISOString()

    await db
      .update(reviewQueue)
      .set({
        status: 'rejected',
        reviewedAt: now,
        reviewNotes: notes ?? null,
      })
      .where(eq(reviewQueue.id, id))

    // Emit review decision signal
    await getCollector().emit({
      type: 'human_review_decision',
      category: this.reviewTypeToCategory(entry.type),
      data: { reviewId: id, type: entry.type, decision: 'rejected', notes },
    })

    return { ...entry, status: 'rejected', reviewedAt: now, reviewNotes: notes ?? null }
  }

  async dismiss(id: string): Promise<void> {
    await db
      .update(reviewQueue)
      .set({
        status: 'dismissed',
        reviewedAt: new Date().toISOString(),
      })
      .where(eq(reviewQueue.id, id))
  }

  async expireOld(): Promise<number> {
    const now = new Date().toISOString()
    const expired = await db
      .select()
      .from(reviewQueue)
      .where(
        and(
          eq(reviewQueue.status, 'pending'),
          lt(reviewQueue.expiresAt, now)
        )
      )

    if (expired.length === 0) return 0

    for (const row of expired) {
      await db
        .update(reviewQueue)
        .set({ status: 'expired', reviewedAt: now })
        .where(eq(reviewQueue.id, row.id))
    }

    return expired.length
  }

  private reviewTypeToCategory(type: string): string {
    const mapping: Record<string, string> = {
      campaign_gate: 'campaign',
      intelligence_confirmation: 'qualification',
      content_review: 'content',
      data_quality: 'qualification',
    }
    return mapping[type] ?? 'qualification'
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  }
}
