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
        enum: ['contact', 'tech_stack', 'email_verify', 'company_research'],
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
      enrichmentType: 'contact' | 'tech_stack' | 'email_verify' | 'company_research'
    }

    // Map enrichmentType → preferred provider id. Registry will fall back via canExecute().
    const providerHint =
      enrichmentType === 'email_verify' || enrichmentType === 'contact' ? 'fullenrich'
      : enrichmentType === 'company_research' ? 'firecrawl'
      : 'mock'

    // Human-readable description so capability-based providers can claim the step.
    const stepDescription =
      enrichmentType === 'email_verify' ? 'Find verified email addresses for contacts'
      : enrichmentType === 'contact' ? 'Enrich with contact email and phone'
      : enrichmentType === 'company_research' ? 'Research company website and extract description'
      : `Enrich ${enrichmentType}`

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

    let provider
    try {
      provider = context.providers.resolve({ stepType: 'enrich', provider: providerHint })
    } catch {
      // Fall back to capability-based resolution if hinted provider is unavailable
      provider = context.providers.resolve({ stepType: 'enrich', provider: 'mock' })
    }

    yield { type: 'progress', message: `Enriching with ${provider.name} (${enrichmentType})...`, percent: 15 }

    const step = {
      stepIndex: 0,
      title: 'Enrich Leads',
      stepType: 'enrich',
      provider: provider.id,
      description: stepDescription,
      config: {
        resultSetId,
        enrichmentType,
        rowCount: rows.length,
      },
    }

    // Inject __rowId so provider-yielded enriched rows can be persisted back to
    // result_rows.data. Without this, enrichment results never reach the DB and
    // subsequent runs re-enrich the same rows from scratch (cost guard is dead).
    const previousStepRows = rows.map(r => {
      const data = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Record<string, unknown>
      return { ...(data ?? {}), __rowId: r.id }
    })

    const executionContext = {
      frameworkContext: '',
      batchSize: 25,
      totalRequested: rows.length,
      previousStepRows,
    }

    let enrichedCount = 0
    for await (const batch of provider.execute(step, executionContext)) {
      enrichedCount += batch.rows.length
      const percent = Math.min(15 + (enrichedCount / rows.length) * 80, 95)

      // Persist enriched rows back to result_rows so subsequent runs can use the
      // cost guard (e.g. row.company_description !== undefined → skip Firecrawl).
      const persistedRows: Array<Record<string, unknown>> = []
      for (const enriched of batch.rows) {
        const rowId = enriched.__rowId as string | undefined
        // Strip the synthetic key before yielding/persisting.
        const { __rowId, ...cleaned } = enriched as Record<string, unknown>
        void __rowId
        persistedRows.push(cleaned)
        if (rowId) {
          try {
            await db.update(resultRows).set({ data: cleaned }).where(eq(resultRows.id, rowId))
          } catch (err) {
            console.error(`[enrich-leads] Failed to persist enriched row ${rowId}:`, err)
          }
        }
      }

      yield { type: 'progress', message: `Enriched ${enrichedCount}/${rows.length} rows...`, percent }
      yield { type: 'result', data: { enrichedRows: persistedRows, batchIndex: batch.batchIndex } }
    }

    yield { type: 'progress', message: `Enrichment complete. ${enrichedCount} rows enriched.`, percent: 100 }
  },
}
