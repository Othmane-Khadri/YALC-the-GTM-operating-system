import type { Skill, SkillEvent, SkillContext } from '../types'

export const findCompaniesSkill: Skill = {
  id: 'find-companies',
  name: 'Find Companies',
  version: '1.0.0',
  description: 'Search for companies matching specific criteria (industry, size, location, stage). Uses the best available search provider.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural language search query' },
      count: { type: 'number', description: 'Number of companies to find', default: 10 },
      filters: {
        type: 'object',
        properties: {
          industry: { type: 'string' },
          employeeRange: { type: 'string' },
          location: { type: 'string' },
          stage: { type: 'string' },
        },
      },
    },
    required: ['query'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: { type: 'object' },
      },
      totalFound: { type: 'number' },
    },
  },
  requiredCapabilities: ['search'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const { query, count = 10, filters = {} } = input as {
      query: string
      count?: number
      filters?: Record<string, unknown>
    }

    yield { type: 'progress', message: 'Resolving search provider...', percent: 5 }

    const provider = context.providers.resolve({ stepType: 'search', provider: 'mock' })

    yield { type: 'progress', message: `Using provider: ${provider.name}`, percent: 10 }

    const step = {
      stepIndex: 0,
      title: 'Find Companies',
      stepType: 'search',
      provider: provider.id,
      description: `Search for ${count} companies: ${query}`,
      config: { query, count, ...filters },
    }

    const executionContext = {
      frameworkContext: '',
      batchSize: count,
      totalRequested: count,
    }

    yield { type: 'progress', message: `Searching for ${count} companies...`, percent: 20 }

    let totalRows = 0
    for await (const batch of provider.execute(step, executionContext)) {
      totalRows += batch.rows.length
      const percent = Math.min(20 + (totalRows / count) * 70, 90)
      yield { type: 'progress', message: `Found ${totalRows} companies...`, percent }
      yield { type: 'result', data: { companies: batch.rows, batchIndex: batch.batchIndex } }
    }

    yield { type: 'progress', message: `Search complete. ${totalRows} companies found.`, percent: 100 }
  },
}
