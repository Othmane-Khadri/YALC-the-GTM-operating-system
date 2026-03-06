import type { Skill, SkillEvent, SkillContext } from '../types'
import { db } from '../../db'
import { resultRows } from '../../db/schema'
import { eq } from 'drizzle-orm'

export const enrichLeadsSkill: Skill = {
  id: 'enrich-leads',
  name: 'Enrich Leads',
  version: '1.0.0',
  description: 'Enrich an existing result set with additional data (contact info, tech stack, email verification). Requires a result set ID from a previous search.',
  category: 'data',
  inputSchema: {
    type: 'object',
    properties: {
      resultSetId: { type: 'string', description: 'ID of the result set to enrich' },
      enrichmentType: {
        type: 'string',
        enum: ['contact', 'tech_stack', 'email_verify'],
        description: 'Type of enrichment to perform',
      },
    },
    required: ['resultSetId', 'enrichmentType'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      enrichedRows: { type: 'array', items: { type: 'object' } },
      enrichedCount: { type: 'number' },
    },
  },
  requiredCapabilities: ['enrich'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { resultSetId, enrichmentType } = input as {
      resultSetId: string
      enrichmentType: 'contact' | 'tech_stack' | 'email_verify'
    }

    yield { type: 'progress', message: 'Loading result set...', percent: 5 }

    const rows = await db
      .select()
      .from(resultRows)
      .where(eq(resultRows.resultSetId, resultSetId))

    if (rows.length === 0) {
      yield { type: 'error', message: `No rows found for result set ${resultSetId}` }
      return
    }

    yield { type: 'progress', message: `Found ${rows.length} rows. Resolving enrichment provider...`, percent: 10 }

    const provider = context.providers.resolve({ stepType: 'enrich', provider: 'mock' })

    yield { type: 'progress', message: `Enriching with ${provider.name} (${enrichmentType})...`, percent: 15 }

    const step = {
      stepIndex: 0,
      title: 'Enrich Leads',
      stepType: 'enrich',
      provider: provider.id,
      description: `Enrich ${rows.length} rows with ${enrichmentType}`,
      config: {
        resultSetId,
        enrichmentType,
        rowCount: rows.length,
      },
    }

    const executionContext = {
      frameworkContext: '',
      batchSize: rows.length,
      totalRequested: rows.length,
    }

    let enrichedCount = 0
    for await (const batch of provider.execute(step, executionContext)) {
      enrichedCount += batch.rows.length
      const percent = Math.min(15 + (enrichedCount / rows.length) * 80, 95)
      yield { type: 'progress', message: `Enriched ${enrichedCount}/${rows.length} rows...`, percent }
      yield { type: 'result', data: { enrichedRows: batch.rows, batchIndex: batch.batchIndex } }
    }

    yield { type: 'progress', message: `Enrichment complete. ${enrichedCount} rows enriched.`, percent: 100 }
  },
}
