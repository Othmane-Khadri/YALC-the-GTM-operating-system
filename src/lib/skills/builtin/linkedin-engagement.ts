import type { Skill, SkillEvent, SkillContext } from '../types'

export const linkedinEngagementSkill: Skill = {
  id: 'linkedin-engagement',
  name: 'LinkedIn Post Engagement',
  version: '1.0.0',
  description: 'Scrape people who liked or commented on a LinkedIn post. Returns names, headlines, LinkedIn URLs, and reaction types. Optionally enriches profiles.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      postUrl: { type: 'string', description: 'LinkedIn post URL to scrape engagements from' },
      engagementType: {
        type: 'string',
        enum: ['likes', 'comments', 'all'],
        description: 'Type of engagement to scrape',
        default: 'all',
      },
      enrichProfiles: {
        type: 'boolean',
        description: 'Whether to enrich profiles with additional data',
        default: false,
      },
      count: { type: 'number', description: 'Maximum number of profiles to return', default: 50 },
    },
    required: ['postUrl'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      profiles: { type: 'array', items: { type: 'object' } },
      totalFound: { type: 'number' },
    },
  },
  requiredCapabilities: ['search'],

  async *execute(input: unknown, context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      postUrl,
      engagementType = 'all',
      enrichProfiles = false,
      count = 50,
    } = input as {
      postUrl: string
      engagementType?: string
      enrichProfiles?: boolean
      count?: number
    }

    yield { type: 'progress', message: 'Resolving LinkedIn engagement provider...', percent: 5 }

    const provider = context.providers.resolve({
      stepType: 'search',
      provider: 'apify-linkedin-engagement',
    })

    yield { type: 'progress', message: `Using provider: ${provider.name}`, percent: 10 }

    const step = {
      stepIndex: 0,
      title: 'LinkedIn Post Engagement',
      stepType: 'search',
      provider: provider.id,
      description: `Scrape ${engagementType} engagements from LinkedIn post`,
      config: { postUrl, engagementType, enrichProfiles },
    }

    const executionContext = {
      frameworkContext: '',
      batchSize: count,
      totalRequested: count,
    }

    yield { type: 'progress', message: 'Scraping LinkedIn post engagements...', percent: 20 }

    let totalRows = 0
    for await (const batch of provider.execute(step, executionContext)) {
      totalRows += batch.rows.length
      const percent = Math.min(20 + (totalRows / count) * 70, 90)
      yield { type: 'progress', message: `Found ${totalRows} profiles...`, percent }
      yield { type: 'result', data: { profiles: batch.rows, batchIndex: batch.batchIndex } }
    }

    yield { type: 'progress', message: `Scrape complete. ${totalRows} profiles found.`, percent: 100 }
  },
}
