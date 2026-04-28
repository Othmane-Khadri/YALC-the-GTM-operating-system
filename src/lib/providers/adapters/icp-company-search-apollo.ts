import type { CapabilityAdapter, AdapterContext } from '../capabilities.js'
import { ProviderApiError } from './index.js'

interface IcpCompanySearchInput {
  industry?: string
  employeeRange?: string
  location?: string
  keywords?: string
  limit?: number
}

/**
 * Apollo company search adapter — runs over the existing MCP provider
 * plumbing (`type: 'mcp'`, id: `apollo`). The Apollo MCP server is
 * registered through `provider:add --mcp apollo`; this adapter only
 * forwards the structured filter as MCP tool arguments. If no Apollo
 * provider is registered the capability registry simply skips it.
 */
export const icpCompanySearchApolloAdapter: CapabilityAdapter = {
  capabilityId: 'icp-company-search',
  providerId: 'apollo',
  async execute(input, ctx: AdapterContext) {
    if (!ctx.executor) {
      throw new ProviderApiError('apollo', 'Apollo provider not registered. Install with: yalc-gtm provider:add --mcp apollo')
    }
    const filters = (input ?? {}) as IcpCompanySearchInput
    const step = {
      stepIndex: 0,
      title: 'icp-company-search',
      stepType: 'search',
      provider: 'apollo',
      description: 'Apollo ICP company search via MCP.',
      config: {
        organization_industries: filters.industry,
        organization_num_employees_ranges: filters.employeeRange,
        organization_locations: filters.location,
        q_keywords: filters.keywords,
        per_page: filters.limit,
      },
    }
    const executionContext = {
      frameworkContext: '',
      batchSize: filters.limit ?? 25,
      totalRequested: filters.limit ?? 25,
      tenantId: ctx.tenantId,
    }
    const companies: Record<string, unknown>[] = []
    try {
      for await (const batch of ctx.executor.execute(step, executionContext)) {
        for (const r of batch.rows) companies.push(r)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new ProviderApiError('apollo', message)
    }
    return { companies }
  },
}
