import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  handleSearchLeads,
  handleGetFramework,
  handleGetLearnings,
  handleQualifyLead,
  handleGetAvailableProviders,
} from './server-tools'

export function createGtmOsServer(): Server {
  const server = new Server(
    { name: 'gtm-os', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
      },
    }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'search_leads',
          description: 'Search for leads/companies matching a query using GTM-OS providers. Returns structured lead data.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              query: { type: 'string', description: 'Search query describing the target companies/leads' },
              count: { type: 'number', description: 'Number of results to return (default: 10)' },
              filters: {
                type: 'object',
                description: 'Optional filters: industry, employeeRange, location, stage',
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
        },
        {
          name: 'get_framework',
          description: "Get the user's GTM framework configuration (ICP, messaging, segments, signals).",
          inputSchema: {
            type: 'object' as const,
            properties: {
              sections: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: specific framework sections to return. Omit for full framework.',
              },
            },
          },
        },
        {
          name: 'get_learnings',
          description: 'Retrieve accumulated GTM learnings and intelligence from past campaigns.',
          inputSchema: {
            type: 'object' as const,
            properties: {
              confidence: { type: 'string', description: 'Filter by confidence level: hypothesis, validated, proven' },
              segment: { type: 'string', description: 'Filter by ICP segment name' },
            },
          },
        },
        {
          name: 'qualify_lead',
          description: "Score and qualify a lead against the user's ICP framework and accumulated learnings.",
          inputSchema: {
            type: 'object' as const,
            properties: {
              lead: { type: 'object', description: 'Lead data object with company/person fields' },
              segment: { type: 'string', description: 'Optional: specific ICP segment to qualify against' },
            },
            required: ['lead'],
          },
        },
        {
          name: 'get_available_providers',
          description: 'List all data providers currently available in GTM-OS (built-in, MCP, mock).',
          inputSchema: {
            type: 'object' as const,
            properties: {},
          },
        },
      ],
    }
  })

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params

    switch (name) {
      case 'search_leads':
        return handleSearchLeads(args as { query: string; count?: number; filters?: Record<string, unknown> })
      case 'get_framework':
        return handleGetFramework(args as { sections?: string[] })
      case 'get_learnings':
        return handleGetLearnings(args as { confidence?: string; segment?: string })
      case 'qualify_lead':
        return handleQualifyLead(args as { lead: Record<string, unknown>; segment?: string })
      case 'get_available_providers':
        return handleGetAvailableProviders()
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  })

  return server
}
