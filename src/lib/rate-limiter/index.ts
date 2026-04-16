import { eq, and, sql, gte } from 'drizzle-orm'
import { db } from '../db'
import { rateLimitBuckets } from '../db/schema'
import { DEFAULT_TENANT } from '../tenant/index.js'

/**
 * Rate limiter — Phase 1 / A4: tenant-scoped.
 *
 * Buckets are keyed by (tenantId, provider, accountId). Legacy callers
 * passing only provider+accountId default to the `'default'` tenant,
 * matching the schema default on pre-existing rows so no data moves.
 */

const RATE_LIMITS: Record<string, number> = {
  'linkedin.connect': 30,   // per day
  'linkedin.dm': 50,        // per day (lowered from 100 during GTM-OS Day 30 announcement, restore after Apr 22)
  'instantly.send': 50,     // per day per account
  'crustdata.search': 100,  // per day (credit proxy)
}

function getNextMidnight(): string {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return tomorrow.toISOString()
}

export class RateLimiter {
  /**
   * Ensure bucket exists and refill if past midnight.
   * Accepts optional Drizzle transaction to run inside acquire's transaction.
   */
  private async refillIfNeeded(
    provider: string,
    accountId: string,
    tenantId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any,
  ): Promise<void> {
    const conn = tx ?? db
    const rows = await conn
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.tenantId, tenantId),
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
      ))
      .limit(1)

    const maxTokens = RATE_LIMITS[provider] ?? 100

    if (rows.length === 0) {
      await conn.insert(rateLimitBuckets).values({
        tenantId,
        provider,
        accountId,
        tokensRemaining: maxTokens,
        maxTokens,
        refillAt: getNextMidnight(),
      })
      return
    }

    const bucket = rows[0]
    const now = new Date()
    const refillAt = new Date(bucket.refillAt)

    if (now >= refillAt) {
      await conn.update(rateLimitBuckets).set({
        tokensRemaining: maxTokens,
        maxTokens,
        refillAt: getNextMidnight(),
      }).where(eq(rateLimitBuckets.id, bucket.id))
    }
  }

  /**
   * Atomically acquire tokens. Runs refill + decrement inside a single
   * SQLite transaction to prevent race conditions between concurrent callers.
   */
  async acquire(
    provider: string,
    accountId: string,
    count = 1,
    tenantId: string = DEFAULT_TENANT,
  ): Promise<boolean> {
    return await db.transaction(async (tx: any) => {
      await this.refillIfNeeded(provider, accountId, tenantId, tx)

      // Atomic: decrement only if enough tokens remain
      const result = await tx.update(rateLimitBuckets).set({
        tokensRemaining: sql`${rateLimitBuckets.tokensRemaining} - ${count}`,
      }).where(and(
        eq(rateLimitBuckets.tenantId, tenantId),
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
        gte(rateLimitBuckets.tokensRemaining, count),
      ))

      // Drizzle returns { changes: number } for SQLite updates
      const changes = (result as unknown as { changes?: number })?.changes ?? 0
      return changes > 0
    })
  }

  async getRemaining(
    provider: string,
    accountId: string,
    tenantId: string = DEFAULT_TENANT,
  ): Promise<number> {
    await this.refillIfNeeded(provider, accountId, tenantId)

    const rows = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.tenantId, tenantId),
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
      ))
      .limit(1)

    if (rows.length === 0) return RATE_LIMITS[provider] ?? 100
    return rows[0].tokensRemaining
  }
}

export const rateLimiter = new RateLimiter()
