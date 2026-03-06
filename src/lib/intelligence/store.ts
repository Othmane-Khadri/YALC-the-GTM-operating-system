import { randomUUID } from 'crypto'
import { eq, and, desc, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db'
import { intelligence as intelligenceTable } from '../db/schema'
import type {
  Intelligence,
  IntelligenceCategory,
  IntelligenceSource,
  ConfidenceLevel,
  BiasCheck,
} from './types'
import { calculateConfidenceScore, shouldPromote as checkShouldPromote } from './confidence'

type CreateInput = Omit<Intelligence, 'id' | 'createdAt' | 'confidenceScore'>

interface QueryFilters {
  category?: IntelligenceCategory
  segment?: string
  channel?: string
  minConfidence?: ConfidenceLevel
  source?: IntelligenceSource
}

export class IntelligenceStore {
  /**
   * Add a new intelligence entry. Computes confidenceScore automatically.
   */
  async add(input: CreateInput): Promise<Intelligence> {
    const id = randomUUID()
    const createdAt = new Date().toISOString()

    const entry: Intelligence = {
      ...input,
      id,
      createdAt,
      confidenceScore: 0,
    }
    entry.confidenceScore = calculateConfidenceScore(entry)

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
    })

    return entry
  }

  /**
   * Retrieve a single intelligence entry by ID.
   */
  async get(id: string): Promise<Intelligence | null> {
    const rows = await db
      .select()
      .from(intelligenceTable)
      .where(eq(intelligenceTable.id, id))
      .limit(1)

    if (rows.length === 0) return null
    return this.deserialize(rows[0])
  }

  /**
   * Query intelligence with optional filters.
   */
  async query(filters: QueryFilters): Promise<Intelligence[]> {
    const conditions = []

    if (filters.category) {
      conditions.push(eq(intelligenceTable.category, filters.category))
    }
    if (filters.segment) {
      conditions.push(eq(intelligenceTable.segment, filters.segment))
    }
    if (filters.channel) {
      conditions.push(eq(intelligenceTable.channel, filters.channel))
    }
    if (filters.minConfidence) {
      const levels: ConfidenceLevel[] = ['hypothesis', 'validated', 'proven']
      const minIndex = levels.indexOf(filters.minConfidence)
      const allowed = levels.slice(minIndex)
      conditions.push(inArray(intelligenceTable.confidence, allowed))
    }
    if (filters.source) {
      conditions.push(eq(intelligenceTable.source, filters.source))
    }

    const rows = await db
      .select()
      .from(intelligenceTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(intelligenceTable.confidenceScore))

    return rows.map(r => this.deserialize(r))
  }

  /**
   * Get intelligence formatted for prompt injection.
   * Returns top 5 proven + top 3 validated relevant to the given segment.
   * NEVER returns hypotheses.
   */
  async getForPrompt(segment?: string): Promise<Intelligence[]> {
    const segmentCondition = segment
      ? or(eq(intelligenceTable.segment, segment), isNull(intelligenceTable.segment))
      : undefined

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
      .limit(5)

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
      .limit(3)

    return [...provenRows, ...validatedRows].map(r => this.deserialize(r))
  }

  /**
   * Recalculate the confidence score for an intelligence entry.
   */
  async updateConfidence(id: string): Promise<void> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Intelligence ${id} not found`)

    const newScore = calculateConfidenceScore(entry)
    await db
      .update(intelligenceTable)
      .set({ confidenceScore: newScore })
      .where(eq(intelligenceTable.id, id))
  }

  /**
   * Mark an old intelligence entry as superseded by a new one.
   */
  async supersede(oldId: string, newIntelligence: CreateInput): Promise<Intelligence> {
    await db
      .update(intelligenceTable)
      .set({ expiresAt: new Date().toISOString() })
      .where(eq(intelligenceTable.id, oldId))

    return this.add({ ...newIntelligence, supersedes: oldId })
  }

  /**
   * Expire an intelligence entry immediately.
   */
  async expire(id: string): Promise<void> {
    await db
      .update(intelligenceTable)
      .set({ expiresAt: new Date().toISOString() })
      .where(eq(intelligenceTable.id, id))
  }

  /**
   * Run a bias check on an intelligence entry.
   */
  async checkBias(id: string): Promise<BiasCheck> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Intelligence ${id} not found`)

    const totalSample = entry.evidence.reduce((sum, e) => sum + e.sampleSize, 0)
    const timestamps = entry.evidence.map(e => new Date(e.timestamp).getTime())
    const timeSpan = timestamps.length >= 2
      ? Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / (1000 * 60 * 60 * 24))
      : 0

    const uniqueSources = new Set(entry.evidence.map(e => e.sourceId))
    const segmentBalance = uniqueSources.size >= 2

    const biasCheck: BiasCheck = {
      sampleSize: totalSample,
      segmentBalance,
      timeSpan,
      recencyWeighted: false,
      checkedAt: new Date().toISOString(),
    }

    await db
      .update(intelligenceTable)
      .set({ biasCheck: JSON.stringify(biasCheck) })
      .where(eq(intelligenceTable.id, id))

    return biasCheck
  }

  /**
   * Promote intelligence to the next confidence level.
   */
  async promote(id: string): Promise<Intelligence> {
    const entry = await this.get(id)
    if (!entry) throw new Error(`Intelligence ${id} not found`)

    const { shouldPromote: canPromote, reason } = checkShouldPromote(entry)
    if (!canPromote) throw new Error(`Cannot promote: ${reason}`)

    const nextLevel: Record<string, ConfidenceLevel> = {
      hypothesis: 'validated',
      validated: 'proven',
    }

    const newConfidence = nextLevel[entry.confidence]
    if (!newConfidence) throw new Error('Already at highest confidence level')

    const now = new Date().toISOString()
    await db
      .update(intelligenceTable)
      .set({
        confidence: newConfidence,
        validatedAt: newConfidence === 'validated' || newConfidence === 'proven' ? now : entry.validatedAt,
      })
      .where(eq(intelligenceTable.id, id))

    return { ...entry, confidence: newConfidence, validatedAt: now }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  }
}
