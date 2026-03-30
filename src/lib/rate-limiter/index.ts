import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { rateLimitBuckets } from '../db/schema'

const RATE_LIMITS: Record<string, number> = {
  'linkedin.connect': 30,   // per day
  'linkedin.dm': 100,       // per day
  'instantly.send': 50,     // per day per account
  'crustdata.search': 100,  // per day (credit proxy)
}

function getNextMidnight(): string {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return tomorrow.toISOString()
}

export class RateLimiter {
  async refillIfNeeded(provider: string, accountId: string): Promise<void> {
    const rows = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
      ))
      .limit(1)

    const maxTokens = RATE_LIMITS[provider] ?? 100

    if (rows.length === 0) {
      // Create new bucket
      await db.insert(rateLimitBuckets).values({
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
      // Refill bucket
      await db.update(rateLimitBuckets).set({
        tokensRemaining: maxTokens,
        maxTokens,
        refillAt: getNextMidnight(),
      }).where(eq(rateLimitBuckets.id, bucket.id))
    }
  }

  async acquire(provider: string, accountId: string, count = 1): Promise<boolean> {
    await this.refillIfNeeded(provider, accountId)

    const rows = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
      ))
      .limit(1)

    if (rows.length === 0) return false

    const bucket = rows[0]
    if (bucket.tokensRemaining < count) return false

    await db.update(rateLimitBuckets).set({
      tokensRemaining: bucket.tokensRemaining - count,
    }).where(eq(rateLimitBuckets.id, bucket.id))

    return true
  }

  async getRemaining(provider: string, accountId: string): Promise<number> {
    await this.refillIfNeeded(provider, accountId)

    const rows = await db
      .select()
      .from(rateLimitBuckets)
      .where(and(
        eq(rateLimitBuckets.provider, provider),
        eq(rateLimitBuckets.accountId, accountId),
      ))
      .limit(1)

    if (rows.length === 0) return RATE_LIMITS[provider] ?? 100
    return rows[0].tokensRemaining
  }
}

export const rateLimiter = new RateLimiter()
