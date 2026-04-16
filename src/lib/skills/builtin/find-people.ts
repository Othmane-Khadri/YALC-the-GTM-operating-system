import type { Skill, SkillEvent, SkillContext } from '../types'

export const findPeopleSkill: Skill = {
  id: 'find-people',
  name: 'Find People',
  version: '2.0.0',
  description:
    'Search for people at specific companies by job title, seniority, or location. Uses Crustdata in-database search (800M+ profiles). Calculates cost BEFORE executing and requires approval.',
  category: 'research',
  inputSchema: {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: { type: 'string' },
        description: 'Company names to search within',
      },
      titles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Job title keywords (substring match)',
      },
      seniorityLevels: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Seniority filter. Valid values: CXO, Vice President, Director, Manager, Senior, Entry, Training, Owner / Partner',
      },
      location: { type: 'string', description: 'Region filter (substring match)' },
      limit: { type: 'number', description: 'Max results to return', default: 100 },
    },
    required: ['companies'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      people: { type: 'array', items: { type: 'object' } },
      totalCount: { type: 'number' },
      estimatedCredits: { type: 'number' },
      actualCredits: { type: 'number' },
      balanceAfter: { type: 'number' },
    },
  },
  requiredCapabilities: ['search'],

  estimatedCost(input: unknown) {
    const { limit = 100 } = input as { limit?: number }
    return Math.max(3, Math.ceil(limit / 100) * 3)
  },

  async *execute(input: unknown, _context: SkillContext): AsyncIterable<SkillEvent> {
    const {
      companies,
      titles,
      seniorityLevels,
      location,
      limit = 100,
    } = input as {
      companies: string[]
      titles?: string[]
      seniorityLevels?: string[]
      location?: string
      limit?: number
    }

    const { crustdataService, estimateCost } = await import('../../services/crustdata')

    if (!crustdataService.isAvailable()) {
      yield { type: 'error', message: 'CRUSTDATA_API_KEY is not set.' }
      return
    }

    // Step 1: Pre-flight — check balance and estimate cost
    yield { type: 'progress', message: 'Checking credit balance...', percent: 5 }

    const balance = await crustdataService.checkCredits()
    const estimate = estimateCost('people_search_db', { resultCount: limit })

    yield {
      type: 'progress',
      message: `Cost estimate: ${estimate.breakdown}. Current balance: ${balance} credits.`,
      percent: 10,
    }

    // Step 2: Request approval before spending credits
    yield {
      type: 'approval_needed',
      title: 'Crustdata People Search — Credit Approval',
      description: [
        `Companies: ${companies.length}`,
        `Title filters: ${titles?.length ?? 0}`,
        `Estimated cost: ~${estimate.credits} credits (${estimate.breakdown})`,
        `Current balance: ${balance} credits`,
        `Balance after: ~${balance - estimate.credits} credits`,
        '',
        'Strategy: DB search only (cheapest path). Live search NOT included.',
      ].join('\n'),
      payload: { estimatedCredits: estimate.credits, balance },
    }

    // Step 3: Execute DB search
    yield {
      type: 'progress',
      message: `Searching ${companies.length} companies via DB search...`,
      percent: 20,
    }

    const maxLimit = Math.min(limit, 1000)
    const allPeople: Record<string, unknown>[] = []
    let totalCount = 0
    let totalActualCredits = 0
    let finalBalance = balance
    let cursor: string | null = null

    do {
      const tracked = await crustdataService.searchPeople({
        companyNames: companies,
        titles,
        seniorityLevels,
        location,
        limit: maxLimit,
        cursor,
      })

      totalActualCredits += tracked.actualCost
      finalBalance = tracked.balanceAfter

      for (const person of tracked.result.people) {
        allPeople.push(person as unknown as Record<string, unknown>)
      }
      totalCount = tracked.result.totalCount
      cursor = tracked.result.nextCursor

      const percent = Math.min(20 + (allPeople.length / Math.max(totalCount, 1)) * 70, 90)
      yield {
        type: 'progress',
        message: `Found ${allPeople.length}${totalCount > 0 ? ` of ${totalCount}` : ''} people. Credits used so far: ${totalActualCredits}.`,
        percent,
      }
    } while (cursor && allPeople.length < limit)

    // Step 4: Report results with credit accounting
    yield {
      type: 'result',
      data: {
        people: allPeople,
        totalCount,
        estimatedCredits: estimate.credits,
        actualCredits: totalActualCredits,
        balanceAfter: finalBalance,
      },
    }

    yield {
      type: 'progress',
      message: [
        `Complete. ${allPeople.length} people found across ${companies.length} companies.`,
        `Credits: estimated=${estimate.credits} actual=${totalActualCredits} balance=${finalBalance}`,
      ].join(' '),
      percent: 100,
    }
  },
}
