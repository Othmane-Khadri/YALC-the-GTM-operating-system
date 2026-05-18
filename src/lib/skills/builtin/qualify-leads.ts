import type { Skill, SkillEvent, SkillContext } from '../types'
import { db } from '../../db'
import { resultRows } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { applyReviewGate } from '../../services/notion-reviews'

export const qualifyLeadsSkill: Skill = {
  id: 'qualify-leads',
  name: 'Qualify Leads',
  version: '1.0.0',
  description: 'Score and qualify leads in a result set against your ICP framework and accumulated learnings. Each lead gets a qualification score and reason.',
  category: 'analysis',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to qualify' },
      segment: { type: 'string', description: 'Optional: specific ICP segment to qualify against' },
      reviewOutputType: {
        type: 'string',
        description: 'Optional: if set and a review surface is registered for this output type, qualified rows are pushed to Notion at Status="To Review" and (when gate_mode=hard) downstream consumers must wait for Approval. See notion-reviews.yaml.',
      },
    },
    required: ['resultSetId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      qualifiedRows: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            score: { type: 'number' },
            reason: { type: 'string' },
            originalData: { type: 'object' },
          },
        },
      },
      summary: {
        type: 'object',
        properties: {
          totalQualified: { type: 'number' },
          averageScore: { type: 'number' },
          highScoreCount: { type: 'number' },
        },
      },
    },
  },
  requiredCapabilities: ['qualify'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, segment, reviewOutputType } = input as {
      resultSetId: string
      segment?: string
      reviewOutputType?: string
    }

    yield { type: 'progress', message: 'Loading result set for qualification...', percent: 5 }

    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` }
      return
    }

    yield { type: 'progress', message: `Qualifying ${rows.length} leads...`, percent: 10 }

    const provider = context.providers.resolve({ stepType: 'qualify', provider: 'mock' })

    const step = {
      stepIndex: 0,
      title: 'Qualify Leads',
      stepType: 'qualify',
      provider: provider.id,
      description: `Qualify ${rows.length} leads${segment ? ` against segment: ${segment}` : ''}`,
      config: {
        resultSetId,
        segment,
        rowCount: rows.length,
      },
    }

    const executionContext = {
      frameworkContext: '',
      batchSize: rows.length,
      totalRequested: rows.length,
    }

    let qualifiedCount = 0
    const allQualified: Record<string, unknown>[] = []

    for await (const batch of provider.execute(step, executionContext)) {
      qualifiedCount += batch.rows.length
      allQualified.push(...batch.rows)
      const percent = Math.min(10 + (qualifiedCount / rows.length) * 80, 90)
      yield { type: 'progress', message: `Qualified ${qualifiedCount}/${rows.length} leads...`, percent }
      yield { type: 'result', data: { qualifiedRows: batch.rows, batchIndex: batch.batchIndex } }
    }

    const scores = allQualified.map(r => {
      const s = r.qualificationScore ?? r.score ?? 50
      return typeof s === 'number' ? s : 50
    })
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const highScoreCount = scores.filter(s => s >= 70).length

    yield {
      type: 'signal',
      signalType: 'qualification_complete',
      data: {
        totalQualified: qualifiedCount,
        averageScore: Math.round(averageScore),
        highScoreCount,
      },
    }

    if (reviewOutputType) {
      const batchMeta: Record<string, unknown> = {
        Campaign: segment ?? `result-set-${resultSetId}`,
        'Lead Count': allQualified.length,
        'Created Date': new Date().toISOString().slice(0, 10),
        'ICP Segment': segment ?? '',
      }
      const gate = await applyReviewGate(reviewOutputType, batchMeta, allQualified)
      switch (gate.action) {
        case 'no-surface':
          break
        case 'pushed-halt':
          yield {
            type: 'signal',
            signalType: 'review_gate_halt',
            data: {
              outputType: reviewOutputType,
              pushed: gate.itemsPushed,
              failed: gate.failed,
              url: gate.url,
              batchPageId: gate.batchPageId,
              itemsDbId: gate.itemsDbId,
              message: `${gate.itemsPushed} leads pushed as one batch to ${gate.url}. Open the batch card in Notion to review the inline items table, then drag it to "Approved".`,
            },
          }
          break
        case 'pushed-continue':
          yield {
            type: 'signal',
            signalType: 'review_gate_continue',
            data: {
              outputType: reviewOutputType,
              pushed: gate.itemsPushed,
              failed: gate.failed,
              url: gate.url,
              batchPageId: gate.batchPageId,
              itemsDbId: gate.itemsDbId,
            },
          }
          break
      }
    }

    yield { type: 'progress', message: `Qualification complete. ${highScoreCount} high-score leads.`, percent: 100 }
  },
}
