/**
 * Built-in capability registration. Each capability is declared once
 * (with its default priority) and the adapters that satisfy it are
 * registered alongside.
 */

import type { CapabilityRegistry } from '../capabilities.js'

export const ICP_COMPANY_SEARCH_CAPABILITY = {
  id: 'icp-company-search',
  description:
    'Find companies that match an ICP filter (industry, headcount, location, keywords). Returns a list of normalized company records.',
  inputSchema: {
    type: 'object',
    properties: {
      industry: { type: 'string', description: 'Industry filter' },
      employeeRange: { type: 'string', description: 'Headcount range (e.g. "11-50")' },
      location: { type: 'string', description: 'Region or country' },
      keywords: { type: 'string', description: 'Free-text keyword filter' },
      limit: { type: 'number', description: 'Max companies to return' },
    },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      companies: {
        type: 'array',
        items: { type: 'object' },
      },
    },
    required: ['companies'],
  },
  defaultPriority: ['crustdata', 'apollo'],
} as const

export const PEOPLE_ENRICH_CAPABILITY = {
  id: 'people-enrich',
  description:
    'Enrich a list of people (firstname/lastname/domain or LinkedIn URL) with email + phone where available.',
  inputSchema: {
    type: 'object',
    properties: {
      contacts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            firstname: { type: 'string' },
            lastname: { type: 'string' },
            domain: { type: 'string' },
            company_name: { type: 'string' },
            linkedin_url: { type: 'string' },
          },
          required: ['firstname', 'lastname'],
        },
      },
    },
    required: ['contacts'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'object' } },
    },
    required: ['results'],
  },
  defaultPriority: ['fullenrich', 'crustdata'],
} as const

export const LINKEDIN_ENGAGER_FETCH_CAPABILITY = {
  id: 'linkedin-engager-fetch',
  description:
    'Fetch the people who reacted to or commented on a LinkedIn post. Returns one row per engager with role + post + engagement type.',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Unipile account id sending the request' },
      postId: { type: 'string', description: 'LinkedIn post social_id' },
      engagementTypes: {
        type: 'array',
        items: { type: 'string', enum: ['reaction', 'comment'] },
        description: 'Which engagements to fetch (default: both).',
      },
    },
    required: ['accountId', 'postId'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      engagers: { type: 'array', items: { type: 'object' } },
    },
    required: ['engagers'],
  },
  defaultPriority: ['unipile'],
} as const

export const REASONING_CAPABILITY = {
  id: 'reasoning',
  description:
    'Single-shot LLM text completion. Used by skills that need natural-language reasoning (synthesis, summarization, extraction).',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'User prompt' },
      maxTokens: { type: 'number' },
      model: { type: 'string', description: 'Provider-specific model id; adapter falls back to its own default.' },
    },
    required: ['prompt'],
  },
  outputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
    },
    required: ['text'],
  },
  defaultPriority: ['anthropic', 'openai'],
} as const

export class MissingApiKeyError extends Error {
  readonly providerId: string
  readonly envVar: string
  constructor(providerId: string, envVar: string) {
    super(`[${providerId}] missing API key: ${envVar} is not set`)
    this.name = 'MissingApiKeyError'
    this.providerId = providerId
    this.envVar = envVar
  }
}

export class ProviderApiError extends Error {
  readonly providerId: string
  readonly status?: number
  constructor(providerId: string, message: string, status?: number) {
    super(`[${providerId}] ${message}`)
    this.name = 'ProviderApiError'
    this.providerId = providerId
    this.status = status
  }
}

export async function registerBuiltinCapabilities(registry: CapabilityRegistry): Promise<void> {
  registry.registerCapability({ ...ICP_COMPANY_SEARCH_CAPABILITY, defaultPriority: [...ICP_COMPANY_SEARCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...PEOPLE_ENRICH_CAPABILITY, defaultPriority: [...PEOPLE_ENRICH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LINKEDIN_ENGAGER_FETCH_CAPABILITY, defaultPriority: [...LINKEDIN_ENGAGER_FETCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...REASONING_CAPABILITY, defaultPriority: [...REASONING_CAPABILITY.defaultPriority] })

  const { icpCompanySearchCrustdataAdapter } = await import('./icp-company-search-crustdata.js')
  const { icpCompanySearchApolloAdapter } = await import('./icp-company-search-apollo.js')
  const { peopleEnrichFullenrichAdapter } = await import('./people-enrich-fullenrich.js')
  const { peopleEnrichCrustdataAdapter } = await import('./people-enrich-crustdata.js')
  const { linkedinEngagerFetchUnipileAdapter } = await import('./linkedin-engager-fetch-unipile.js')
  const { reasoningAnthropicAdapter } = await import('./reasoning-anthropic.js')
  const { reasoningOpenAIAdapter } = await import('./reasoning-openai.js')

  registry.register(icpCompanySearchCrustdataAdapter)
  registry.register(icpCompanySearchApolloAdapter)
  registry.register(peopleEnrichFullenrichAdapter)
  registry.register(peopleEnrichCrustdataAdapter)
  registry.register(linkedinEngagerFetchUnipileAdapter)
  registry.register(reasoningAnthropicAdapter)
  registry.register(reasoningOpenAIAdapter)
}
