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
  defaultPriority: ['crustdata', 'apollo', 'pappers'],
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

export const FUNDING_FEED_CAPABILITY = {
  id: 'funding-feed',
  description:
    'Detect recent funding events for a company (or a feed of recently-funded companies in an ICP segment).',
  inputSchema: {
    type: 'object',
    properties: {
      companyDomain: { type: 'string', description: 'Single-company mode: domain to enrich.' },
      baselineFundingTotal: { type: 'number', description: 'Last known total funding (USD).' },
      segments: { type: 'string', description: 'Feed mode: ICP segments to filter the feed by.' },
      minRoundSizeUsd: { type: 'number', description: 'Skip rounds smaller than this.' },
      window: { type: 'string', description: 'Time window like "24h" or "7d".' },
      limit: { type: 'number' },
    },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    description: 'Either { changed, summary, data, newBaseline } (single-company mode) or { companies } (feed mode).',
  },
  defaultPriority: ['crustdata'],
} as const

export const HIRING_SIGNAL_CAPABILITY = {
  id: 'hiring-signal',
  description:
    'Detect a meaningful surge in open job postings for a company relative to a baseline count.',
  inputSchema: {
    type: 'object',
    properties: {
      companyDomain: { type: 'string' },
      baselineJobCount: { type: 'number' },
      threshold: { type: 'number', description: 'Minimum delta to fire a signal (default 5).' },
    },
    required: ['companyDomain'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      changed: { type: 'boolean' },
      summary: { type: 'string' },
      data: { type: 'object' },
      newBaseline: { type: 'object' },
    },
    required: ['changed'],
  },
  defaultPriority: ['crustdata'],
} as const

export const PERSON_JOB_CHANGE_SIGNAL_CAPABILITY = {
  id: 'person-job-change-signal',
  description:
    'Detect whether a person changed their job title or company since the last baseline check.',
  inputSchema: {
    type: 'object',
    properties: {
      personLinkedinUrl: { type: 'string' },
      baselineTitle: { type: 'string' },
      baselineCompany: { type: 'string' },
    },
    required: ['personLinkedinUrl'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      changed: { type: 'boolean' },
      summary: { type: 'string' },
      data: { type: 'object' },
      newBaseline: { type: 'object' },
    },
    required: ['changed'],
  },
  defaultPriority: ['crustdata'],
} as const

export const NEWS_FEED_CAPABILITY = {
  id: 'news-feed',
  description:
    'Find recent news items for a company or topic. Returns a list of url+title+snippet records.',
  inputSchema: {
    type: 'object',
    properties: {
      companyDomain: { type: 'string' },
      query: { type: 'string', description: 'Free-form search query (overrides companyDomain).' },
      lastCheckDate: { type: 'string', description: 'ISO date — items received before this should be filtered downstream.' },
      limit: { type: 'number' },
    },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object' } },
    },
    required: ['items'],
  },
  defaultPriority: ['firecrawl'],
} as const

export const WEB_FETCH_CAPABILITY = {
  id: 'web-fetch',
  description:
    'Fetch a single web URL or run a search query. Returns extracted markdown for URL fetches; ranked URL+snippet rows for searches.',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'Single URL to fetch (mutually exclusive with `query`).' },
      query: { type: 'string', description: 'Search query (mutually exclusive with `url`).' },
      limit: { type: 'number', description: 'Result cap when running in search mode.' },
    },
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    description: 'Either { url, markdown } (URL mode) or { query, results } (search mode).',
  },
  defaultPriority: ['firecrawl'],
} as const

export const INBOX_REPLIES_FETCH_CAPABILITY = {
  id: 'inbox-replies-fetch',
  description:
    'Pull recent inbound replies from a cold-email tool within a lookback window.',
  inputSchema: {
    type: 'object',
    properties: {
      lookbackHours: { type: 'number' },
      limit: { type: 'number' },
    },
    required: ['lookbackHours'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      replies: { type: 'array', items: { type: 'object' } },
    },
    required: ['replies'],
  },
  defaultPriority: ['instantly', 'brevo'],
} as const

export const LINKEDIN_USER_POSTS_FETCH_CAPABILITY = {
  id: 'linkedin-user-posts-fetch',
  description:
    'Fetch recent LinkedIn posts for a given user (defaults to "me" — the authenticated account holder).',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string', description: 'Unipile account id sending the request.' },
      userId: { type: 'string', description: 'LinkedIn user id (default "me").' },
      limit: { type: 'number' },
    },
    required: ['accountId'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      posts: { type: 'array', items: { type: 'object' } },
    },
    required: ['posts'],
  },
  defaultPriority: ['unipile'],
} as const

export const LINKEDIN_CONTENT_FETCH_CAPABILITY = {
  id: 'linkedin-content-fetch',
  description:
    'Fetch recent posts authored by a competitor LinkedIn URL (or explicit user id).',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string' },
      competitorUrl: { type: 'string', description: 'LinkedIn URL of the competitor profile or company.' },
      userId: { type: 'string', description: 'Optional explicit user id (skips URL resolution).' },
      limit: { type: 'number' },
    },
    required: ['accountId'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      posts: { type: 'array', items: { type: 'object' } },
    },
    required: ['posts'],
  },
  defaultPriority: ['unipile'],
} as const

export const LINKEDIN_TRENDING_CONTENT_CAPABILITY = {
  id: 'linkedin-trending-content',
  description:
    'Search LinkedIn for high-engagement posts matching a keyword (engagement floor configurable).',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string' },
      keyword: { type: 'string', description: 'Free-text search query.' },
      minEngagement: { type: 'number', description: 'Minimum likes+comments (default 50).' },
      limit: { type: 'number' },
    },
    required: ['accountId', 'keyword'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      posts: { type: 'array', items: { type: 'object' } },
    },
    required: ['posts'],
  },
  defaultPriority: ['unipile'],
} as const

export const LINKEDIN_CAMPAIGN_CREATE_CAPABILITY = {
  id: 'linkedin-campaign-create',
  description:
    'Create a LinkedIn outreach campaign (sequence + leads) and start the first step. Subsequent DMs are scheduled by `campaign:track`.',
  inputSchema: {
    type: 'object',
    properties: {
      accountId: { type: 'string' },
      campaignName: { type: 'string' },
      leads: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            provider_id: { type: 'string' },
            message: { type: 'string' },
          },
          required: ['provider_id'],
        },
      },
      sequence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['connection', 'dm'] },
            delay_days: { type: 'number' },
            body: { type: 'string' },
          },
          required: ['kind', 'body'],
        },
      },
    },
    required: ['accountId', 'campaignName', 'leads', 'sequence'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      status: { type: 'string' },
      leadsAttempted: { type: 'number' },
      leadsSucceeded: { type: 'number' },
    },
    required: ['campaignId', 'status'],
  },
  defaultPriority: ['unipile'],
} as const

export const EMAIL_CAMPAIGN_CREATE_CAPABILITY = {
  id: 'email-campaign-create',
  description:
    'Create an email outreach campaign (sequence + leads) and start it via the configured cold-email provider.',
  inputSchema: {
    type: 'object',
    properties: {
      campaignName: { type: 'string' },
      leads: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            company: { type: 'string' },
          },
          required: ['email'],
        },
      },
      sequence: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            subject: { type: 'string' },
            body: { type: 'string' },
            delay_days: { type: 'number' },
            variant_label: { type: 'string' },
          },
          required: ['body'],
        },
      },
      accountIds: { type: 'array', items: { type: 'string' } },
    },
    required: ['campaignName', 'sequence'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      campaignId: { type: 'string' },
      status: { type: 'string' },
      leadsAdded: { type: 'number' },
    },
    required: ['campaignId', 'status'],
  },
  defaultPriority: ['instantly'],
} as const

export const ASSET_RENDERING_CAPABILITY = {
  id: 'asset-rendering',
  description:
    'Render an HTML or markdown asset to disk (and optionally to PDF/PNG via Playwright when installed).',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'HTML body or markdown to render.' },
      filename: { type: 'string' },
      format: { type: 'string', enum: ['html', 'pdf', 'png'] },
      title: { type: 'string' },
    },
    required: ['content'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      rendered: { type: 'boolean' },
      path: { type: 'string' },
      format: { type: 'string' },
      fallbackReason: { type: ['string', 'null'] },
    },
    required: ['rendered', 'path', 'format'],
  },
  defaultPriority: ['builtin'],
} as const

export const LANDING_PAGE_DEPLOY_CAPABILITY = {
  id: 'landing-page-deploy',
  description:
    'Deploy a single-page HTML asset to a hosted URL (vercel-mcp when configured; local file fallback otherwise).',
  inputSchema: {
    type: 'object',
    properties: {
      html: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
    },
    required: ['html'],
    additionalProperties: true,
  },
  outputSchema: {
    type: 'object',
    properties: {
      deployed: { type: 'boolean' },
      url: { type: 'string' },
      fallbackReason: { type: ['string', 'null'] },
    },
    required: ['deployed', 'url'],
  },
  defaultPriority: ['vercel-mcp'],
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
  registry.registerCapability({ ...FUNDING_FEED_CAPABILITY, defaultPriority: [...FUNDING_FEED_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...HIRING_SIGNAL_CAPABILITY, defaultPriority: [...HIRING_SIGNAL_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...PERSON_JOB_CHANGE_SIGNAL_CAPABILITY, defaultPriority: [...PERSON_JOB_CHANGE_SIGNAL_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...NEWS_FEED_CAPABILITY, defaultPriority: [...NEWS_FEED_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...WEB_FETCH_CAPABILITY, defaultPriority: [...WEB_FETCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...INBOX_REPLIES_FETCH_CAPABILITY, defaultPriority: [...INBOX_REPLIES_FETCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LINKEDIN_USER_POSTS_FETCH_CAPABILITY, defaultPriority: [...LINKEDIN_USER_POSTS_FETCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LINKEDIN_CONTENT_FETCH_CAPABILITY, defaultPriority: [...LINKEDIN_CONTENT_FETCH_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LINKEDIN_TRENDING_CONTENT_CAPABILITY, defaultPriority: [...LINKEDIN_TRENDING_CONTENT_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LINKEDIN_CAMPAIGN_CREATE_CAPABILITY, defaultPriority: [...LINKEDIN_CAMPAIGN_CREATE_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...EMAIL_CAMPAIGN_CREATE_CAPABILITY, defaultPriority: [...EMAIL_CAMPAIGN_CREATE_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...ASSET_RENDERING_CAPABILITY, defaultPriority: [...ASSET_RENDERING_CAPABILITY.defaultPriority] })
  registry.registerCapability({ ...LANDING_PAGE_DEPLOY_CAPABILITY, defaultPriority: [...LANDING_PAGE_DEPLOY_CAPABILITY.defaultPriority] })

  const { icpCompanySearchCrustdataAdapter } = await import('./icp-company-search-crustdata.js')
  const { icpCompanySearchApolloAdapter } = await import('./icp-company-search-apollo.js')
  const { icpCompanySearchPappersAdapter } = await import('./icp-company-search-pappers.js')
  const { peopleEnrichFullenrichAdapter } = await import('./people-enrich-fullenrich.js')
  const { peopleEnrichCrustdataAdapter } = await import('./people-enrich-crustdata.js')
  const { linkedinEngagerFetchUnipileAdapter } = await import('./linkedin-engager-fetch-unipile.js')
  const { reasoningAnthropicAdapter } = await import('./reasoning-anthropic.js')
  const { reasoningOpenAIAdapter } = await import('./reasoning-openai.js')
  const { fundingFeedCrustdataAdapter } = await import('./funding-feed-crustdata.js')
  const { hiringSignalCrustdataAdapter } = await import('./hiring-signal-crustdata.js')
  const { personJobChangeSignalCrustdataAdapter } = await import('./person-job-change-signal-crustdata.js')
  const { newsFeedFirecrawlAdapter } = await import('./news-feed-firecrawl.js')
  const { webFetchFirecrawlAdapter } = await import('./web-fetch-firecrawl.js')
  const { inboxRepliesFetchInstantlyAdapter } = await import('./inbox-replies-fetch-instantly.js')
  const { linkedinUserPostsFetchUnipileAdapter } = await import('./linkedin-user-posts-fetch-unipile.js')
  const { linkedinContentFetchUnipileAdapter } = await import('./linkedin-content-fetch-unipile.js')
  const { linkedinTrendingContentUnipileAdapter } = await import('./linkedin-trending-content-unipile.js')
  const { linkedinCampaignCreateUnipileAdapter } = await import('./linkedin-campaign-create-unipile.js')
  const { emailCampaignCreateInstantlyAdapter } = await import('./email-campaign-create-instantly.js')
  const { assetRenderingStubAdapter } = await import('./asset-rendering-stub.js')
  const { landingPageDeployStubAdapter } = await import('./landing-page-deploy-stub.js')

  registry.register(icpCompanySearchCrustdataAdapter)
  registry.register(icpCompanySearchApolloAdapter)
  registry.register(icpCompanySearchPappersAdapter)
  registry.register(peopleEnrichFullenrichAdapter)
  registry.register(peopleEnrichCrustdataAdapter)
  registry.register(linkedinEngagerFetchUnipileAdapter)
  registry.register(reasoningAnthropicAdapter)
  registry.register(reasoningOpenAIAdapter)
  registry.register(fundingFeedCrustdataAdapter)
  registry.register(hiringSignalCrustdataAdapter)
  registry.register(personJobChangeSignalCrustdataAdapter)
  registry.register(newsFeedFirecrawlAdapter)
  registry.register(webFetchFirecrawlAdapter)
  registry.register(inboxRepliesFetchInstantlyAdapter)
  registry.register(linkedinUserPostsFetchUnipileAdapter)
  registry.register(linkedinContentFetchUnipileAdapter)
  registry.register(linkedinTrendingContentUnipileAdapter)
  registry.register(linkedinCampaignCreateUnipileAdapter)
  registry.register(emailCampaignCreateInstantlyAdapter)
  registry.register(assetRenderingStubAdapter)
  registry.register(landingPageDeployStubAdapter)
}
