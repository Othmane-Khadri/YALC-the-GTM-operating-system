import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parseCondition,
  evaluateCondition,
  checkCondition,
  validateCondition,
  ConditionParseError,
} from '../conditions'
import {
  applyExplicitTransform,
  autoMapFields,
  applyPipelineTransform,
  validateStepTransform,
} from '../transforms'

// ─── Condition Evaluator Tests ──────────────────────────────────────────────

describe('Condition Parser', () => {
  it('parses equality comparison', () => {
    const node = parseCondition('status == active')
    expect(node.type).toBe('leaf')
    expect(node.condition?.type).toBe('comparison')
    expect(node.condition?.field).toBe('status')
    expect(node.condition?.operator).toBe('==')
    expect(node.condition?.value).toBe('active')
  })

  it('parses numeric comparison', () => {
    const node = parseCondition('score >= 80')
    expect(node.condition?.operator).toBe('>=')
    expect(node.condition?.value).toBe(80)
  })

  it('parses exists check', () => {
    const node = parseCondition('email exists')
    expect(node.condition?.type).toBe('exists')
    expect(node.condition?.field).toBe('email')
  })

  it('parses contains check', () => {
    const node = parseCondition('name contains John')
    expect(node.condition?.type).toBe('contains')
    expect(node.condition?.field).toBe('name')
    expect(node.condition?.value).toBe('John')
  })

  it('parses AND combinator', () => {
    const node = parseCondition('score > 80 AND email exists')
    expect(node.type).toBe('and')
    expect(node.left?.condition?.field).toBe('score')
    expect(node.right?.condition?.field).toBe('email')
  })

  it('parses OR combinator', () => {
    const node = parseCondition('score > 90 OR vip == true')
    expect(node.type).toBe('or')
  })

  it('AND binds tighter than OR', () => {
    // "a OR b AND c" should be parsed as "a OR (b AND c)"
    const node = parseCondition('a == 1 OR b == 2 AND c == 3')
    expect(node.type).toBe('or')
    expect(node.right?.type).toBe('and')
  })

  it('parses boolean values', () => {
    const node = parseCondition('active == true')
    expect(node.condition?.value).toBe(true)
  })

  it('parses quoted string values', () => {
    const node = parseCondition('name == "John Doe"')
    expect(node.condition?.value).toBe('John Doe')
  })

  it('throws on empty expression', () => {
    expect(() => parseCondition('')).toThrow(ConditionParseError)
  })

  it('throws on invalid syntax', () => {
    expect(() => parseCondition('just a random string without operators')).toThrow(ConditionParseError)
  })
})

describe('Condition Evaluation', () => {
  it('evaluates == correctly', () => {
    expect(checkCondition('status == active', { status: 'active' })).toBe(true)
    expect(checkCondition('status == active', { status: 'inactive' })).toBe(false)
  })

  it('evaluates != correctly', () => {
    expect(checkCondition('status != inactive', { status: 'active' })).toBe(true)
    expect(checkCondition('status != active', { status: 'active' })).toBe(false)
  })

  it('evaluates numeric > correctly', () => {
    expect(checkCondition('score > 80', { score: 90 })).toBe(true)
    expect(checkCondition('score > 80', { score: 70 })).toBe(false)
    expect(checkCondition('score > 80', { score: 80 })).toBe(false)
  })

  it('evaluates numeric >= correctly', () => {
    expect(checkCondition('score >= 80', { score: 80 })).toBe(true)
    expect(checkCondition('score >= 80', { score: 79 })).toBe(false)
  })

  it('evaluates numeric < correctly', () => {
    expect(checkCondition('score < 50', { score: 30 })).toBe(true)
    expect(checkCondition('score < 50', { score: 60 })).toBe(false)
  })

  it('evaluates numeric <= correctly', () => {
    expect(checkCondition('score <= 50', { score: 50 })).toBe(true)
  })

  it('evaluates exists correctly', () => {
    expect(checkCondition('email exists', { email: 'a@b.com' })).toBe(true)
    expect(checkCondition('email exists', {})).toBe(false)
    expect(checkCondition('email exists', { email: null })).toBe(false)
    expect(checkCondition('email exists', { email: undefined })).toBe(false)
  })

  it('evaluates contains for strings', () => {
    expect(checkCondition('name contains john', { name: 'John Doe' })).toBe(true)
    expect(checkCondition('name contains xyz', { name: 'John Doe' })).toBe(false)
  })

  it('evaluates contains for arrays', () => {
    expect(checkCondition('tags contains sales', { tags: ['sales', 'gtm'] })).toBe(true)
    expect(checkCondition('tags contains hr', { tags: ['sales', 'gtm'] })).toBe(false)
  })

  it('evaluates boolean equality', () => {
    expect(checkCondition('active == true', { active: true })).toBe(true)
    expect(checkCondition('active == false', { active: false })).toBe(true)
    expect(checkCondition('active == true', { active: false })).toBe(false)
  })

  it('evaluates AND correctly', () => {
    expect(checkCondition('score > 80 AND email exists', { score: 90, email: 'a@b.com' })).toBe(true)
    expect(checkCondition('score > 80 AND email exists', { score: 90 })).toBe(false)
    expect(checkCondition('score > 80 AND email exists', { score: 70, email: 'a@b.com' })).toBe(false)
  })

  it('evaluates OR correctly', () => {
    expect(checkCondition('score > 90 OR vip == true', { score: 50, vip: true })).toBe(true)
    expect(checkCondition('score > 90 OR vip == true', { score: 95, vip: false })).toBe(true)
    expect(checkCondition('score > 90 OR vip == true', { score: 50, vip: false })).toBe(false)
  })

  it('evaluates nested field paths', () => {
    expect(checkCondition('company.domain exists', { company: { domain: 'example.com' } })).toBe(true)
    expect(checkCondition('company.domain exists', { company: {} })).toBe(false)
  })

  it('handles missing fields gracefully in comparisons', () => {
    expect(checkCondition('score > 80', {})).toBe(false)
  })
})

describe('Condition Validation', () => {
  it('returns null for valid conditions', () => {
    expect(validateCondition('score > 80')).toBeNull()
    expect(validateCondition('email exists')).toBeNull()
    expect(validateCondition('score > 80 AND email exists')).toBeNull()
  })

  it('returns error message for invalid conditions', () => {
    const result = validateCondition('just gibberish')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('returns error for empty string', () => {
    expect(validateCondition('')).toBeTruthy()
  })
})

// ─── Transform Engine Tests ─────────────────────────────────────────────────

describe('Explicit Transform', () => {
  it('maps source fields to target fields', () => {
    const output = { company_url: 'https://example.com', name: 'Acme' }
    const mapping = { company_url: 'domain' }
    const result = applyExplicitTransform(output, mapping)
    expect(result).toEqual({ domain: 'https://example.com' })
  })

  it('skips missing source fields', () => {
    const output = { name: 'Acme' }
    const mapping = { company_url: 'domain' }
    const result = applyExplicitTransform(output, mapping)
    expect(result).toEqual({})
  })

  it('handles multiple mappings', () => {
    const output = { company_url: 'https://example.com', contact_email: 'a@b.com', extra: true }
    const mapping = { company_url: 'domain', contact_email: 'email' }
    const result = applyExplicitTransform(output, mapping)
    expect(result).toEqual({ domain: 'https://example.com', email: 'a@b.com' })
  })
})

describe('Auto Map Fields', () => {
  it('maps matching field names from output to schema', () => {
    const output = { domain: 'example.com', name: 'Acme', extra: true }
    const schema = { properties: { domain: { type: 'string' }, email: { type: 'string' } } }
    const result = autoMapFields(output, schema)
    expect(result).toEqual({ domain: 'example.com' })
  })

  it('handles flat schema format', () => {
    const output = { domain: 'example.com', score: 85 }
    const schema = { domain: 'string', score: 'number' }
    const result = autoMapFields(output, schema)
    expect(result).toEqual({ domain: 'example.com', score: 85 })
  })
})

describe('Pipeline Transform (combined)', () => {
  it('merges auto-map, explicit transform, and step input', () => {
    const prevOutput = { domain: 'example.com', company_url: 'https://example.com', name: 'Acme' }
    const stepInput = { types: ['email'] }
    const mapping = { company_url: 'url' }
    const schema = { properties: { domain: { type: 'string' }, types: { type: 'array' } } }

    const result = applyPipelineTransform(prevOutput, stepInput, mapping, schema)
    expect(result.domain).toBe('example.com')
    expect(result.url).toBe('https://example.com')
    expect(result.types).toEqual(['email'])
  })

  it('step input overrides auto-mapped fields', () => {
    const prevOutput = { format: 'json' }
    const stepInput = { format: 'csv' }
    const schema = { format: 'string' }

    const result = applyPipelineTransform(prevOutput, stepInput, undefined, schema)
    expect(result.format).toBe('csv')
  })

  it('handles array output (wraps in items/count)', () => {
    const prevOutput = [{ name: 'A' }, { name: 'B' }]
    const stepInput = {}
    const schema = { items: 'array', count: 'number' }

    const result = applyPipelineTransform(prevOutput, stepInput, undefined, schema)
    expect(result.items).toEqual(prevOutput)
    expect(result.count).toBe(2)
  })

  it('handles null output', () => {
    const result = applyPipelineTransform(null, { key: 'val' })
    expect(result).toEqual({ key: 'val' })
  })
})

describe('Validate Step Transform', () => {
  it('detects missing required fields', () => {
    const outputFields = ['domain', 'name']
    const requiredInputFields = ['domain', 'linkedin_url']
    const stepInput = {}
    const missing = validateStepTransform(outputFields, requiredInputFields, stepInput)
    expect(missing).toEqual(['linkedin_url'])
  })

  it('considers step input as satisfying fields', () => {
    const outputFields = ['domain']
    const requiredInputFields = ['domain', 'format']
    const stepInput = { format: 'csv' }
    const missing = validateStepTransform(outputFields, requiredInputFields, stepInput)
    expect(missing).toEqual([])
  })

  it('considers explicit transform mappings', () => {
    const outputFields = ['company_url']
    const requiredInputFields = ['domain']
    const stepInput = {}
    const mapping = { company_url: 'domain' }
    const missing = validateStepTransform(outputFields, requiredInputFields, stepInput, mapping)
    expect(missing).toEqual([])
  })

  it('returns empty when all fields satisfied', () => {
    const outputFields = ['domain', 'email', 'name']
    const requiredInputFields = ['domain', 'email']
    const stepInput = {}
    const missing = validateStepTransform(outputFields, requiredInputFields, stepInput)
    expect(missing).toEqual([])
  })
})

// ─── Pipeline Validation Tests ──────────────────────────────────────────────

describe('Pipeline Validation', () => {
  // We test validatePipeline indirectly through its behavior.
  // Direct tests require the skill registry which we can mock.

  it('loadPipeline throws on missing file', async () => {
    const { loadPipeline } = await import('../chain')
    expect(() => loadPipeline('/nonexistent/path.yaml')).toThrow('not found')
  })

  it('loadPipeline throws on empty steps', async () => {
    const { loadPipeline } = await import('../chain')
    const { writeFileSync, mkdirSync, unlinkSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const yaml = (await import('js-yaml')).default

    const tmpFile = join(tmpdir(), `test-pipeline-${Date.now()}.yaml`)
    writeFileSync(tmpFile, yaml.dump({ name: 'test', steps: [] }))
    try {
      expect(() => loadPipeline(tmpFile)).toThrow('at least one step')
    } finally {
      unlinkSync(tmpFile)
    }
  })

  it('loadPipeline throws on missing name', async () => {
    const { loadPipeline } = await import('../chain')
    const { writeFileSync, unlinkSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const yaml = (await import('js-yaml')).default

    const tmpFile = join(tmpdir(), `test-pipeline-noname-${Date.now()}.yaml`)
    writeFileSync(tmpFile, yaml.dump({ steps: [{ skill: 'test' }] }))
    try {
      expect(() => loadPipeline(tmpFile)).toThrow('name')
    } finally {
      unlinkSync(tmpFile)
    }
  })
})

// ─── Checkpoint Tests ───────────────────────────────────────────────────────

describe('Checkpoint', () => {
  it('loadCheckpoint returns null for non-existent pipeline', async () => {
    const { loadCheckpoint } = await import('../chain')
    const result = loadCheckpoint('non-existent-pipeline-' + Date.now())
    expect(result).toBeNull()
  })
})

// ─── Dry Run Mode Tests ─────────────────────────────────────────────────────

describe('Dry Run', () => {
  it('dry run collects events without executing skills', async () => {
    const { executePipeline } = await import('../chain')
    const { writeFileSync, unlinkSync } = await import('fs')
    const { join } = await import('path')
    const { tmpdir } = await import('os')
    const yaml = (await import('js-yaml')).default

    // Create a minimal pipeline YAML that references a real skill
    const tmpFile = join(tmpdir(), `test-dryrun-${Date.now()}.yaml`)
    writeFileSync(tmpFile, yaml.dump({
      name: 'dry-run-test',
      description: 'Test pipeline',
      steps: [
        { skill: 'find-companies', input: { query: 'test' }, output: 'companies' },
        { skill: 'enrich-leads', from: 'companies', condition: 'domain exists', output: 'enriched' },
      ],
    }))

    const context = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'test',
    }

    const events: any[] = []
    try {
      for await (const event of executePipeline({ file: tmpFile, dryRun: true }, context)) {
        events.push(event)
      }
    } finally {
      unlinkSync(tmpFile)
    }

    // Should have progress events but no result events (no skills actually ran)
    const progressEvents = events.filter(e => e.type === 'progress')
    const resultEvents = events.filter(e => e.type === 'result')
    expect(progressEvents.length).toBeGreaterThan(0)
    expect(resultEvents.length).toBe(0)

    // Should mention dry-run
    expect(progressEvents.some(e => e.message.includes('dry-run'))).toBe(true)
  })
})
