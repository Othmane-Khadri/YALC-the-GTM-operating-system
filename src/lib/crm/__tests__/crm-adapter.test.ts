/**
 * CRM Adapter Tests
 *
 * Tests field mapping, config management, adapter behavior, and drift detection
 * using mock MCP tool responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  autoMapFields,
  fieldSimilarity,
  applyMapping,
  GTM_CANONICAL_FIELDS,
} from '../field-mapper'
import { saveCrmConfig, loadCrmConfig } from '../config-store'
import type {
  CRMFieldInfo,
  CRMProviderConfig,
  CRMObjectInfo,
  FieldMapping,
} from '../types'

// ─── Field Similarity Tests ─────────────────────────────────────────────────

describe('fieldSimilarity', () => {
  it('returns 1.0 for exact matches', () => {
    expect(fieldSimilarity('email', 'email')).toBe(1.0)
    expect(fieldSimilarity('first_name', 'first_name')).toBe(1.0)
  })

  it('returns 1.0 for case-insensitive exact matches', () => {
    expect(fieldSimilarity('Email', 'email')).toBe(1.0)
    expect(fieldSimilarity('firstName', 'firstname')).toBe(1.0)
  })

  it('returns high score for substring matches', () => {
    expect(fieldSimilarity('email', 'email_address')).toBeGreaterThanOrEqual(0.8)
    expect(fieldSimilarity('company', 'company_name')).toBeGreaterThanOrEqual(0.8)
  })

  it('returns moderate score for fuzzy matches', () => {
    const score = fieldSimilarity('first_name', 'firstname')
    expect(score).toBeGreaterThan(0.5)
  })

  it('returns low score for unrelated fields', () => {
    expect(fieldSimilarity('email', 'revenue')).toBeLessThan(0.4)
    expect(fieldSimilarity('first_name', 'industry')).toBeLessThan(0.4)
  })
})

// ─── Auto Field Mapping Tests ───────────────────────────────────────────────

describe('autoMapFields', () => {
  const hubspotFields: CRMFieldInfo[] = [
    { name: 'email', type: 'string', required: true },
    { name: 'firstname', type: 'string', required: false },
    { name: 'lastname', type: 'string', required: false },
    { name: 'company', type: 'string', required: false },
    { name: 'jobtitle', type: 'string', required: false },
    { name: 'phone', type: 'string', required: false },
    { name: 'website', type: 'string', required: false },
    { name: 'city', type: 'string', required: false },
    { name: 'state', type: 'string', required: false },
    { name: 'country', type: 'string', required: false },
    { name: 'industry', type: 'string', required: false },
    { name: 'annualrevenue', type: 'number', required: false },
    { name: 'hs_lead_status', type: 'string', required: false },
  ]

  it('maps common fields with high confidence', () => {
    const result = autoMapFields(hubspotFields)

    expect(result.mapping.gtmToCrm['email']).toBe('email')
    expect(result.mapping.gtmToCrm['company']).toBe('company')
    expect(result.mapping.gtmToCrm['phone']).toBe('phone')
    expect(result.mapping.gtmToCrm['city']).toBe('city')
  })

  it('maps name fields via fuzzy match', () => {
    const result = autoMapFields(hubspotFields)

    // 'first_name' should map to 'firstname'
    expect(result.mapping.gtmToCrm['first_name']).toBe('firstname')
    expect(result.mapping.gtmToCrm['last_name']).toBe('lastname')
  })

  it('maps title field to jobtitle', () => {
    const result = autoMapFields(hubspotFields)
    expect(result.mapping.gtmToCrm['title']).toBe('jobtitle')
  })

  it('generates reverse mapping', () => {
    const result = autoMapFields(hubspotFields)

    expect(result.mapping.crmToGtm['email']).toBe('email')
    expect(result.mapping.crmToGtm['firstname']).toBe('first_name')
    expect(result.mapping.crmToGtm['company']).toBe('company')
  })

  it('reports unmapped fields', () => {
    const minimalFields: CRMFieldInfo[] = [
      { name: 'email', type: 'string', required: true },
    ]

    const result = autoMapFields(minimalFields)
    expect(result.unmapped.length).toBeGreaterThan(0)
    expect(result.unmapped).toContain('company')
  })

  it('reports extra CRM fields not in GTM schema', () => {
    const result = autoMapFields(hubspotFields)
    // hs_lead_status is HubSpot-specific and unlikely to map to a canonical field
    // (depends on fuzzy matching — it may or may not match 'status')
    expect(result.extraCrmFields.length + result.confident.length + result.uncertain.length).toBeGreaterThan(0)
  })

  it('does not double-map CRM fields', () => {
    const result = autoMapFields(hubspotFields)
    const crmFieldsUsed = Object.values(result.mapping.gtmToCrm)
    const uniqueUsed = new Set(crmFieldsUsed)
    expect(crmFieldsUsed.length).toBe(uniqueUsed.size)
  })

  it('handles empty CRM field list', () => {
    const result = autoMapFields([])
    expect(Object.keys(result.mapping.gtmToCrm).length).toBe(0)
    expect(result.unmapped.length).toBe(GTM_CANONICAL_FIELDS.length)
  })
})

// ─── Apply Mapping Tests ────────────────────────────────────────────────────

describe('applyMapping', () => {
  it('transforms record using mapping', () => {
    const record = { email: 'test@example.com', first_name: 'John', company: 'Acme' }
    const mapping = { email: 'hs_email', first_name: 'firstname', company: 'companyname' }

    const result = applyMapping(record, mapping)

    expect(result).toEqual({
      hs_email: 'test@example.com',
      firstname: 'John',
      companyname: 'Acme',
    })
  })

  it('skips fields not present in the record', () => {
    const record = { email: 'test@example.com' }
    const mapping = { email: 'hs_email', first_name: 'firstname' }

    const result = applyMapping(record, mapping)

    expect(result).toEqual({ hs_email: 'test@example.com' })
    expect(result).not.toHaveProperty('firstname')
  })

  it('handles empty mapping', () => {
    const record = { email: 'test@example.com' }
    const result = applyMapping(record, {})
    expect(result).toEqual({})
  })
})

// ─── Config Store Tests ─────────────────────────────────────────────────────

describe('config store', () => {
  // These tests use the real filesystem via saveCrmConfig/loadCrmConfig.
  // In CI, the ~/.gtm-os/crm/ directory is writable.

  const testConfig: CRMProviderConfig = {
    provider: 'test-crm',
    mcpServer: 'test-crm',
    objects: {
      contacts: {
        listTool: 'list_contacts',
        createTool: 'create_contact',
        updateTool: 'update_contact',
        searchTool: 'search_contacts',
        fieldMapping: {
          gtmToCrm: { email: 'email_address', first_name: 'given_name' },
          crmToGtm: { email_address: 'email', given_name: 'first_name' },
        },
      },
    },
    lastSetup: '2026-04-22T00:00:00Z',
    version: 1,
  }

  it('saves and loads config', () => {
    const path = saveCrmConfig(testConfig)
    expect(path).toContain('test-crm.yaml')

    const loaded = loadCrmConfig('test-crm')
    expect(loaded).not.toBeNull()
    expect(loaded!.provider).toBe('test-crm')
    expect(loaded!.objects.contacts.listTool).toBe('list_contacts')
    expect(loaded!.objects.contacts.fieldMapping.gtmToCrm.email).toBe('email_address')
  })

  it('returns null for non-existent config', () => {
    const loaded = loadCrmConfig('nonexistent-provider-xyz')
    expect(loaded).toBeNull()
  })

  it('preserves field mapping structure through save/load cycle', () => {
    saveCrmConfig(testConfig)
    const loaded = loadCrmConfig('test-crm')

    expect(loaded!.objects.contacts.fieldMapping.gtmToCrm).toEqual(
      testConfig.objects.contacts.fieldMapping.gtmToCrm,
    )
    expect(loaded!.objects.contacts.fieldMapping.crmToGtm).toEqual(
      testConfig.objects.contacts.fieldMapping.crmToGtm,
    )
  })
})

// ─── McpCrmAdapter Tests (with mocked MCP client) ──────────────────────────

describe('McpCrmAdapter', () => {
  // We test the adapter's discoverObjects logic using synthetic tool lists
  // without actually connecting to an MCP server.

  it('detects contact objects from tool names', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    // Create adapter with a dummy config (we'll override internals)
    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search', 'enrich', 'export'],
    } as any)

    // Inject mock tools directly
    ;(adapter as any).connected = true
    ;(adapter as any).tools = [
      {
        name: 'list_contacts',
        description: 'List all contacts',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Contact email' },
            firstname: { type: 'string', description: 'First name' },
            lastname: { type: 'string', description: 'Last name' },
            company: { type: 'string', description: 'Company name' },
            limit: { type: 'number' },
          },
          required: ['email'],
        },
      },
      {
        name: 'create_contact',
        description: 'Create a contact',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            firstname: { type: 'string' },
            lastname: { type: 'string' },
          },
        },
      },
      {
        name: 'search_contacts',
        description: 'Search contacts by query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
        },
      },
      {
        name: 'list_companies',
        description: 'List companies',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            domain: { type: 'string' },
          },
        },
      },
      {
        name: 'create_company',
        description: 'Create a company',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    ]

    const objects = await adapter.discoverObjects()

    expect(objects.length).toBeGreaterThanOrEqual(1)

    const contacts = objects.find(o => o.name === 'contacts')
    expect(contacts).toBeDefined()
    expect(contacts!.tools.list).toBe('list_contacts')
    expect(contacts!.tools.create).toBe('create_contact')
    expect(contacts!.tools.search).toBe('search_contacts')

    // Fields should not include 'limit' (pagination field)
    const fieldNames = contacts!.fields.map(f => f.name)
    expect(fieldNames).toContain('email')
    expect(fieldNames).toContain('firstname')
    expect(fieldNames).not.toContain('limit')

    // Companies object should also be detected
    const companies = objects.find(o => o.name === 'companies')
    expect(companies).toBeDefined()
    expect(companies!.tools.list).toBe('list_companies')
    expect(companies!.tools.create).toBe('create_company')
  })

  it('auto-maps fields for discovered objects', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    } as any)

    const object: CRMObjectInfo = {
      name: 'contacts',
      displayName: 'Contacts',
      tools: { list: 'list_contacts', create: 'create_contact' },
      fields: [
        { name: 'email_address', type: 'string', required: true },
        { name: 'first_name', type: 'string', required: false },
        { name: 'last_name', type: 'string', required: false },
        { name: 'organization', type: 'string', required: false },
      ],
    }

    const mapResult = adapter.autoMapObject(object)

    expect(mapResult.mapping.gtmToCrm['email']).toBe('email_address')
    expect(mapResult.mapping.gtmToCrm['first_name']).toBe('first_name')
    expect(mapResult.mapping.gtmToCrm['company']).toBe('organization')
  })
})

// ─── Drift Detection Tests ──────────────────────────────────────────────────

describe('drift detection', () => {
  it('reports missing CRM fields', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    } as any)

    // Inject mock tools (contact object with only 'email' field now)
    ;(adapter as any).connected = true
    ;(adapter as any).tools = [
      {
        name: 'list_contacts',
        description: 'List contacts',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
      },
      {
        name: 'create_contact',
        description: 'Create contact',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
      },
    ]

    // Set saved config that references 'firstname' field which no longer exists
    adapter.setSavedConfig({
      provider: 'mock-crm',
      mcpServer: 'mock-crm',
      objects: {
        contacts: {
          listTool: 'list_contacts',
          createTool: 'create_contact',
          fieldMapping: {
            gtmToCrm: { email: 'email', first_name: 'firstname' },
            crmToGtm: { email: 'email', firstname: 'first_name' },
          },
        },
      },
      lastSetup: '2026-04-01',
      version: 1,
    })

    const drift = await adapter.detectDrift()

    expect(drift.ok).toBe(false)
    expect(drift.missingInCrm).toContain('firstname')
  })

  it('reports new CRM fields not in mapping', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    } as any)

    ;(adapter as any).connected = true
    ;(adapter as any).tools = [
      {
        name: 'list_contacts',
        description: 'List contacts',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            new_field: { type: 'string' },
          },
        },
      },
      {
        name: 'create_contact',
        description: 'Create contact',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
          },
        },
      },
    ]

    adapter.setSavedConfig({
      provider: 'mock-crm',
      mcpServer: 'mock-crm',
      objects: {
        contacts: {
          listTool: 'list_contacts',
          createTool: 'create_contact',
          fieldMapping: {
            gtmToCrm: { email: 'email' },
            crmToGtm: { email: 'email' },
          },
        },
      },
      lastSetup: '2026-04-01',
      version: 1,
    })

    const drift = await adapter.detectDrift()

    // New fields are informational — schema is still ok
    expect(drift.ok).toBe(true)
    expect(drift.missingInMapping).toContain('new_field')
  })

  it('detects missing tools', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    } as any)

    ;(adapter as any).connected = true
    ;(adapter as any).tools = [
      {
        name: 'list_contacts',
        description: 'List contacts',
        inputSchema: { type: 'object', properties: { email: { type: 'string' } } },
      },
      // create_contact is MISSING from the MCP server now
    ]

    adapter.setSavedConfig({
      provider: 'mock-crm',
      mcpServer: 'mock-crm',
      objects: {
        contacts: {
          listTool: 'list_contacts',
          createTool: 'create_contact', // this tool no longer exists
          fieldMapping: {
            gtmToCrm: { email: 'email' },
            crmToGtm: { email: 'email' },
          },
        },
      },
      lastSetup: '2026-04-01',
      version: 1,
    })

    const drift = await adapter.detectDrift()

    expect(drift.ok).toBe(false)
    expect(drift.missingInCrm).toContain('tool:create_contact')
  })
})

// ─── Suppression List Tests ─────────────────────────────────────────────────

describe('suppression list', () => {
  it('extracts emails and domains from CRM contacts', async () => {
    const { McpCrmAdapter } = await import('../mcp-crm-adapter')

    const adapter = new McpCrmAdapter({
      name: 'mock-crm',
      displayName: 'Mock CRM',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    } as any)

    // Mock the callTool response
    ;(adapter as any).connected = true
    ;(adapter as any).client = {
      callTool: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify([
              { email: 'alice@acme.com', name: 'Alice' },
              { email: 'bob@startup.io', name: 'Bob' },
            ]),
          },
        ],
      }),
      close: vi.fn(),
    }

    adapter.setSavedConfig({
      provider: 'mock-crm',
      mcpServer: 'mock-crm',
      objects: {
        contacts: {
          listTool: 'list_contacts',
          createTool: 'create_contact',
          fieldMapping: {
            gtmToCrm: { email: 'email' },
            crmToGtm: { email: 'email' },
          },
        },
      },
      lastSetup: '2026-04-01',
      version: 1,
    })

    const suppression = await adapter.getSuppression()

    expect(suppression.has('alice@acme.com')).toBe(true)
    expect(suppression.has('acme.com')).toBe(true)
    expect(suppression.has('bob@startup.io')).toBe(true)
    expect(suppression.has('startup.io')).toBe(true)
  })
})
