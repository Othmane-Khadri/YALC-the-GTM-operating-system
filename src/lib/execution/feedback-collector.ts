import { createInterface } from 'readline'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { resultRows, resultSets } from '../db/schema'
import { extractLearnings } from './learning-extractor'
import { IntelligenceStore } from '../intelligence/store'
import type { ColumnDef } from '../ai/types'

export async function collectFeedback(resultSetId: string): Promise<void> {
  console.log(`[review] Loading result set ${resultSetId}...`)

  // Load result set metadata
  const sets = await db.select().from(resultSets).where(eq(resultSets.id, resultSetId)).limit(1)
  if (sets.length === 0) {
    console.log('[review] Result set not found.')
    return
  }

  const columns: ColumnDef[] = sets[0].columnsDefinition
    ? (typeof sets[0].columnsDefinition === 'string'
      ? JSON.parse(sets[0].columnsDefinition)
      : sets[0].columnsDefinition) as ColumnDef[]
    : [{ key: 'data', label: 'Data', type: 'text' }]

  // Load rows
  const rows = await db.select().from(resultRows).where(eq(resultRows.resultSetId, resultSetId))
  if (rows.length === 0) {
    console.log('[review] No rows to review.')
    return
  }

  console.log(`[review] ${rows.length} rows to review. For each, enter: a (approve), r (reject), f (flag), s (skip)\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const prompt = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve))

  const approved: Record<string, unknown>[] = []
  const rejected: Record<string, unknown>[] = []
  const flagged: Record<string, unknown>[] = []

  for (const row of rows) {
    const data = (typeof row.data === 'string' ? JSON.parse(row.data) : row.data) as Record<string, unknown>

    // Display key fields
    console.log(`\n── Row ${row.rowIndex + 1}/${rows.length} ──`)
    for (const col of columns.slice(0, 8)) {
      console.log(`  ${col.label}: ${data[col.key] ?? '—'}`)
    }

    const answer = await prompt('\n  [a]pprove / [r]eject / [f]lag / [s]kip: ')
    const choice = answer.trim().toLowerCase()

    let feedback: string | null = null
    switch (choice) {
      case 'a':
        feedback = 'approved'
        approved.push(data)
        break
      case 'r':
        feedback = 'rejected'
        rejected.push(data)
        break
      case 'f':
        feedback = 'flagged'
        flagged.push(data)
        break
      default:
        continue
    }

    if (feedback) {
      await db.update(resultRows).set({ feedback, updatedAt: new Date() }).where(eq(resultRows.id, row.id))
    }
  }

  rl.close()

  console.log(`\n── Review Summary ──`)
  console.log(`Approved: ${approved.length}`)
  console.log(`Rejected: ${rejected.length}`)
  console.log(`Flagged:  ${flagged.length}`)

  // Extract learnings
  if (approved.length + rejected.length > 0) {
    console.log('\n[review] Extracting learnings from feedback...')
    try {
      const patterns = await extractLearnings({
        approvedRows: approved,
        rejectedRows: rejected,
        flaggedRows: flagged,
        columns,
      })

      const store = new IntelligenceStore()
      for (const pattern of patterns) {
        await store.add({
          category: pattern.category ?? 'qualification',
          insight: pattern.insight,
          evidence: [{
            type: 'rlhf',
            sourceId: resultSetId,
            metric: 'user_feedback',
            value: pattern.evidence_count,
            sampleSize: approved.length + rejected.length + flagged.length,
            timestamp: new Date().toISOString(),
          }],
          segment: pattern.segment ?? null,
          channel: null,
          confidence: pattern.confidence,
          source: 'rlhf',
          biasCheck: null,
          supersedes: null,
          validatedAt: null,
          expiresAt: null,
        })
      }

      console.log(`[review] ${patterns.length} learning(s) extracted and saved:`)
      for (const p of patterns) {
        console.log(`  [${p.confidence}] ${p.insight}`)
      }
    } catch (err) {
      console.log(`[review] Learning extraction skipped: ${err instanceof Error ? err.message : err}`)
    }
  }
}
