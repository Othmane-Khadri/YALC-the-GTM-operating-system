import { randomUUID } from 'crypto'
import { desc, gte, eq, and } from 'drizzle-orm'
import { db } from '../db'
import { signalsLog } from '../db/schema'
import type { Signal, SignalType } from './types'

export class SignalCollector {
  async emit(signal: Omit<Signal, 'id' | 'createdAt'>): Promise<void> {
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    await db.insert(signalsLog).values({
      id,
      type: signal.type,
      category: signal.category,
      data: JSON.stringify(signal.data),
      conversationId: signal.conversationId ?? null,
      resultSetId: signal.resultSetId ?? null,
      campaignId: signal.campaignId ?? null,
      createdAt,
    })
  }

  async getRecent(since: Date, category?: string): Promise<Signal[]> {
    const sinceStr = since.toISOString()
    const conditions = [gte(signalsLog.createdAt, sinceStr)]

    if (category) {
      conditions.push(eq(signalsLog.category, category))
    }

    const rows = await db
      .select()
      .from(signalsLog)
      .where(and(...conditions))
      .orderBy(desc(signalsLog.createdAt))

    return rows.map(r => this.deserialize(r))
  }

  async getCount(since: Date): Promise<number> {
    const sinceStr = since.toISOString()
    const rows = await db
      .select()
      .from(signalsLog)
      .where(gte(signalsLog.createdAt, sinceStr))

    return rows.length
  }

  async getRecentByType(since: Date, type: SignalType): Promise<Signal[]> {
    const sinceStr = since.toISOString()
    const rows = await db
      .select()
      .from(signalsLog)
      .where(and(gte(signalsLog.createdAt, sinceStr), eq(signalsLog.type, type)))
      .orderBy(desc(signalsLog.createdAt))

    return rows.map(r => this.deserialize(r))
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deserialize(row: any): Signal {
    return {
      id: row.id,
      type: row.type,
      category: row.category,
      data: typeof row.data === 'string' ? JSON.parse(row.data) : (row.data ?? {}),
      conversationId: row.conversationId ?? undefined,
      resultSetId: row.resultSetId ?? undefined,
      campaignId: row.campaignId ?? undefined,
      createdAt: row.createdAt,
    }
  }
}

// Module-level singleton
let _collector: SignalCollector | null = null

export function getCollector(): SignalCollector {
  if (!_collector) {
    _collector = new SignalCollector()
  }
  return _collector
}
