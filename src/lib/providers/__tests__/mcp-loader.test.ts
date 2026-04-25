import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { validateMcpConfig, expandEnvVars, getMcpTemplateDir, listTemplateConfigs } from '../mcp-loader'

// ─── Config Validation ───────────────────────────────────────────────────────

describe('validateMcpConfig', () => {
  it('accepts valid stdio config', () => {
    const config = {
      name: 'hubspot',
      displayName: 'HubSpot CRM',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@hubspot/mcp-server'],
      env: { HUBSPOT_ACCESS_TOKEN: '${HUBSPOT_ACCESS_TOKEN}' },
      capabilities: ['search', 'enrich', 'export'],
      healthCheck: { tool: 'list_contacts', timeout: 5000 },
    }
    const result = validateMcpConfig(config, 'hubspot.json')
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts valid sse config', () => {
    const config = {
      name: 'apollo',
      displayName: 'Apollo.io',
      transport: 'sse',
      url: 'https://mcp.apollo.io/sse',
      headers: { Authorization: 'Bearer test' },
      capabilities: ['search', 'enrich'],
    }
    const result = validateMcpConfig(config, 'apollo.json')
    expect(result.valid).toBe(true)
  })

  it('rejects non-object input', () => {
    const result = validateMcpConfig('not an object', 'bad.json')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('not a valid JSON object')
  })

  it('rejects missing name', () => {
    const config = {
      displayName: 'Test',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"name"'))).toBe(true)
  })

  it('rejects missing displayName', () => {
    const config = {
      name: 'test',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"displayName"'))).toBe(true)
  })

  it('rejects invalid transport', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'websocket',
      capabilities: ['search'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"transport"'))).toBe(true)
  })

  it('rejects stdio without command', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'stdio',
      capabilities: ['search'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"command"'))).toBe(true)
  })

  it('rejects sse without url', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'sse',
      capabilities: ['search'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"url"'))).toBe(true)
  })

  it('rejects empty capabilities', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'stdio',
      command: 'echo',
      capabilities: [],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('"capabilities"'))).toBe(true)
  })

  it('rejects invalid capability value', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search', 'invalid_cap'],
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('invalid_cap'))).toBe(true)
  })

  it('rejects invalid healthCheck', () => {
    const config = {
      name: 'test',
      displayName: 'Test',
      transport: 'stdio',
      command: 'echo',
      capabilities: ['search'],
      healthCheck: 'not-an-object',
    }
    const result = validateMcpConfig(config, 'test.json')
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('healthCheck'))).toBe(true)
  })

  it('collects multiple errors at once', () => {
    const config = {} // missing everything
    const result = validateMcpConfig(config, 'empty.json')
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(1)
  })
})

// ─── Environment Variable Expansion ──────────────────────────────────────────

describe('expandEnvVars', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.TEST_KEY = 'test-value-123'
    process.env.ANOTHER_KEY = 'another-value'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('expands ${VAR} in strings', () => {
    const { result, missing } = expandEnvVars('Bearer ${TEST_KEY}')
    expect(result).toBe('Bearer test-value-123')
    expect(missing).toHaveLength(0)
  })

  it('expands multiple vars in one string', () => {
    const { result } = expandEnvVars('${TEST_KEY}:${ANOTHER_KEY}')
    expect(result).toBe('test-value-123:another-value')
  })

  it('tracks missing variables', () => {
    const { result, missing } = expandEnvVars('${DOES_NOT_EXIST}')
    expect(result).toBe('${DOES_NOT_EXIST}')
    expect(missing).toContain('DOES_NOT_EXIST')
  })

  it('recursively expands objects', () => {
    const input = {
      env: { TOKEN: '${TEST_KEY}' },
      url: 'https://api.example.com',
    }
    const { result } = expandEnvVars(input)
    expect((result as any).env.TOKEN).toBe('test-value-123')
    expect((result as any).url).toBe('https://api.example.com')
  })

  it('recursively expands arrays', () => {
    const input = ['${TEST_KEY}', 'literal', '${ANOTHER_KEY}']
    const { result } = expandEnvVars(input)
    expect(result).toEqual(['test-value-123', 'literal', 'another-value'])
  })

  it('passes through non-string primitives', () => {
    expect(expandEnvVars(42).result).toBe(42)
    expect(expandEnvVars(true).result).toBe(true)
    expect(expandEnvVars(null).result).toBe(null)
  })

  it('accumulates missing vars across nested structures', () => {
    const input = {
      a: '${MISSING_A}',
      b: { c: '${MISSING_B}' },
    }
    const { missing } = expandEnvVars(input)
    expect(missing).toContain('MISSING_A')
    expect(missing).toContain('MISSING_B')
  })
})

// ─── Template Resolution ─────────────────────────────────────────────────────

describe('getMcpTemplateDir / listTemplateConfigs', () => {
  it('resolves the shipped configs/mcp directory regardless of CWD', () => {
    const originalCwd = process.cwd()
    try {
      process.chdir(tmpdir())
      const dir = getMcpTemplateDir()
      expect(dir).not.toBeNull()
      expect(dir!.endsWith('/configs/mcp')).toBe(true)
    } finally {
      process.chdir(originalCwd)
    }
  })

  it('lists shipped template names from outside the repo', () => {
    const originalCwd = process.cwd()
    try {
      process.chdir(tmpdir())
      const names = listTemplateConfigs()
      expect(names).toContain('apollo')
    } finally {
      process.chdir(originalCwd)
    }
  })
})

// ─── Registry Integration ────────────────────────────────────────────────────

import { ProviderRegistry } from '../registry'
import type { StepExecutor, RowBatch, WorkflowStepInput, ExecutionContext, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'

function makeFakeProvider(overrides: Partial<StepExecutor> & { id: string; type: 'builtin' | 'mcp' | 'mock' }): StepExecutor {
  return {
    name: overrides.id,
    description: 'test',
    capabilities: ['search'] as ProviderCapability[],
    isAvailable: () => true,
    canExecute: () => true,
    execute: async function* (): AsyncGenerator<RowBatch> { yield { rows: [], batchIndex: 0, totalSoFar: 0 } },
    getColumnDefinitions: () => [] as ColumnDef[],
    ...overrides,
  }
}

describe('MCP registry integration', () => {
  it('MCP providers participate in capability-based resolution', () => {
    const registry = new ProviderRegistry()

    registry.register(makeFakeProvider({ id: 'mock', type: 'mock' }))
    registry.register(makeFakeProvider({ id: 'mcp:hubspot', type: 'mcp' }))

    // MCP should be preferred over mock
    const resolved = registry.resolve({ stepType: 'search', provider: 'auto' })
    expect(resolved.type).toBe('mcp')
  })

  it('getAll reflects MCP provider status correctly', () => {
    const registry = new ProviderRegistry()

    registry.register(makeFakeProvider({ id: 'mcp:available', type: 'mcp', isAvailable: () => true, canExecute: () => false }))
    registry.register(makeFakeProvider({ id: 'mcp:unavailable', type: 'mcp', isAvailable: () => false, canExecute: () => false }))

    const all = registry.getAll()
    const available = all.find(p => p.id === 'mcp:available')
    const unavailable = all.find(p => p.id === 'mcp:unavailable')

    expect(available?.status).toBe('active')
    expect(unavailable?.status).toBe('disconnected')
  })
})
