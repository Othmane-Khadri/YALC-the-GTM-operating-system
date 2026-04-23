import { describe, it, expect, vi, beforeEach } from 'vitest'
import { validateMarkdownSkill } from '../markdown-validator'
import type { MarkdownSkillDefinition } from '../markdown-validator'

// We need to import the non-filesystem functions for unit testing
// The loader module exports parseMarkdownFrontmatter, substituteTemplateVars, buildSkillFromDefinition
// We test them indirectly through loadMarkdownSkill, or directly via the exported helpers.

// Dynamic imports so we can mock fs
let parseMarkdownFrontmatter: typeof import('../markdown-loader').parseMarkdownFrontmatter
let substituteTemplateVars: typeof import('../markdown-loader').substituteTemplateVars
let buildSkillFromDefinition: typeof import('../markdown-loader').buildSkillFromDefinition

beforeEach(async () => {
  const mod = await import('../markdown-loader')
  parseMarkdownFrontmatter = mod.parseMarkdownFrontmatter
  substituteTemplateVars = mod.substituteTemplateVars
  buildSkillFromDefinition = mod.buildSkillFromDefinition
})

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe('parseMarkdownFrontmatter', () => {
  it('parses valid frontmatter and body', () => {
    const md = `---
name: test-skill
description: A test skill
provider: mock
inputs:
  - name: query
    description: Search query
    required: true
capabilities: [search, enrich]
---

You are doing {{query}}.`

    const result = parseMarkdownFrontmatter(md)
    expect(result.frontmatter.name).toBe('test-skill')
    expect(result.frontmatter.description).toBe('A test skill')
    expect(result.frontmatter.provider).toBe('mock')
    expect(result.frontmatter.capabilities).toEqual(['search', 'enrich'])
    expect(Array.isArray(result.frontmatter.inputs)).toBe(true)
    const inputs = result.frontmatter.inputs as Array<Record<string, unknown>>
    expect(inputs[0].name).toBe('query')
    expect(inputs[0].description).toBe('Search query')
    expect(inputs[0].required).toBe(true)
    expect(result.body).toContain('You are doing {{query}}.')
  })

  it('returns empty frontmatter for files without frontmatter', () => {
    const md = 'Just a plain prompt.'
    const result = parseMarkdownFrontmatter(md)
    expect(result.frontmatter).toEqual({})
    expect(result.body).toBe('Just a plain prompt.')
  })

  it('handles inline arrays', () => {
    const md = `---
name: test
capabilities: [a, b, c]
---

body`
    const result = parseMarkdownFrontmatter(md)
    expect(result.frontmatter.capabilities).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateMarkdownSkill', () => {
  const validDef: MarkdownSkillDefinition = {
    name: 'test-skill',
    description: 'A test skill',
    inputs: [
      { name: 'query', description: 'Search query', required: true },
    ],
    provider: 'mock',
    capabilities: ['search'],
  }

  it('returns no errors for valid definition', () => {
    const errors = validateMarkdownSkill(validDef, 'Use {{query}} to search.')
    expect(errors).toEqual([])
  })

  it('detects missing required frontmatter fields', () => {
    const errors = validateMarkdownSkill(
      { ...validDef, name: '' as any },
      'Use {{query}} to search.',
    )
    expect(errors.some(e => e.includes('Missing required frontmatter field: name'))).toBe(true)
  })

  it('detects all missing fields, not just the first', () => {
    const errors = validateMarkdownSkill(
      { name: '', description: '', inputs: [], provider: '' } as any,
      'body',
    )
    // inputs: [] is present (not missing), so only 3 fields are missing: name, description, provider
    expect(errors.filter(e => e.includes('Missing required'))).toHaveLength(3)
  })

  it('detects invalid skill name format', () => {
    const errors = validateMarkdownSkill(
      { ...validDef, name: 'BadName' },
      'Use {{query}} to search.',
    )
    expect(errors.some(e => e.includes('Invalid skill name'))).toBe(true)
  })

  it('detects duplicate input names', () => {
    const errors = validateMarkdownSkill(
      {
        ...validDef,
        inputs: [
          { name: 'query', description: 'First', required: true },
          { name: 'query', description: 'Duplicate', required: true },
        ],
      },
      'Use {{query}} to search.',
    )
    expect(errors.some(e => e.includes('Duplicate input name: query'))).toBe(true)
  })

  it('detects template variables without corresponding inputs', () => {
    const errors = validateMarkdownSkill(
      validDef,
      'Use {{query}} and {{unknown_var}} to search.',
    )
    expect(errors.some(e => e.includes('{{unknown_var}}'))).toBe(true)
  })

  it('detects empty prompt template', () => {
    const errors = validateMarkdownSkill(validDef, '')
    expect(errors.some(e => e.includes('Prompt template (body) is empty'))).toBe(true)
  })

  it('detects invalid category', () => {
    const errors = validateMarkdownSkill(
      { ...validDef, category: 'invalid' },
      'Use {{query}} to search.',
    )
    expect(errors.some(e => e.includes('Invalid category'))).toBe(true)
  })

  it('detects missing input name', () => {
    const errors = validateMarkdownSkill(
      {
        ...validDef,
        inputs: [{ name: '', description: 'no name' } as any],
      },
      'body',
    )
    expect(errors.some(e => e.includes('missing "name"'))).toBe(true)
  })

  it('detects missing input description', () => {
    const errors = validateMarkdownSkill(
      {
        ...validDef,
        inputs: [{ name: 'foo', description: '' } as any],
      },
      'Use {{foo}}.',
    )
    expect(errors.some(e => e.includes('missing "description"'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

describe('substituteTemplateVars', () => {
  const inputs = [
    { name: 'company', description: 'Company name', required: true },
    { name: 'question', description: 'Question', required: true },
    { name: 'extra', description: 'Extra info', required: false },
  ]

  it('substitutes all variables correctly', () => {
    const result = substituteTemplateVars(
      'Research {{company}} about {{question}}.',
      { company: 'Acme', question: 'pricing' },
      inputs,
    )
    expect(result).toBe('Research Acme about pricing.')
  })

  it('throws for missing required input', () => {
    expect(() =>
      substituteTemplateVars(
        'Research {{company}} about {{question}}.',
        { company: 'Acme' },
        inputs,
      ),
    ).toThrow('Missing required input: question')
  })

  it('substitutes empty string for missing optional input', () => {
    const result = substituteTemplateVars(
      'Info: {{extra}}',
      {},
      inputs,
    )
    expect(result).toBe('Info: ')
  })
})

// ---------------------------------------------------------------------------
// buildSkillFromDefinition — Skill object shape
// ---------------------------------------------------------------------------

describe('buildSkillFromDefinition', () => {
  const def: MarkdownSkillDefinition = {
    name: 'test-skill',
    description: 'A test skill',
    inputs: [
      { name: 'query', description: 'Search query', required: true },
    ],
    provider: 'mock',
    capabilities: ['search'],
    category: 'research',
    version: '2.0.0',
  }

  it('creates a valid Skill object with correct id', () => {
    const skill = buildSkillFromDefinition(def, 'Search {{query}}.')
    expect(skill.id).toBe('md:test-skill')
    expect(skill.name).toBe('Test Skill')
    expect(skill.version).toBe('2.0.0')
    expect(skill.description).toBe('A test skill')
    expect(skill.category).toBe('research')
    expect(skill.requiredCapabilities).toEqual(['search'])
  })

  it('sets up inputSchema with required fields', () => {
    const skill = buildSkillFromDefinition(def, 'Search {{query}}.')
    expect(skill.inputSchema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
      required: ['query'],
    })
  })

  it('defaults version to 1.0.0', () => {
    const skill = buildSkillFromDefinition({ ...def, version: undefined }, 'Search {{query}}.')
    expect(skill.version).toBe('1.0.0')
  })

  it('defaults category to research for unknown values', () => {
    const skill = buildSkillFromDefinition({ ...def, category: 'unknown' }, 'Search {{query}}.')
    expect(skill.category).toBe('research')
  })

  it('execute() yields error for missing required input', async () => {
    const skill = buildSkillFromDefinition(def, 'Search {{query}}.')
    const events: import('../types').SkillEvent[] = []
    const mockContext = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => ({ id: 'mock', name: 'mock', execute: async function*() {} }) } as any,
      userId: 'test',
    }

    for await (const event of skill.execute({}, mockContext)) {
      events.push(event)
    }

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as any).message).toContain('Missing required input: query')
  })

  it('execute() yields provider-not-found error with install instructions', async () => {
    const skill = buildSkillFromDefinition(
      { ...def, provider: 'apollo' },
      'Search {{query}}.',
    )
    const events: import('../types').SkillEvent[] = []
    const mockContext = {
      framework: null as any,
      intelligence: [],
      providers: {
        resolve: () => { throw new Error('not found') },
      } as any,
      userId: 'test',
    }

    for await (const event of skill.execute({ query: 'test' }, mockContext)) {
      events.push(event)
    }

    const errorEvent = events.find(e => e.type === 'error')
    expect(errorEvent).toBeDefined()
    expect((errorEvent as any).message).toContain("Provider 'apollo' not found")
    expect((errorEvent as any).message).toContain('provider:add --mcp apollo')
  })

  it('execute() yields results from provider', async () => {
    const skill = buildSkillFromDefinition(def, 'Search {{query}}.')
    const events: import('../types').SkillEvent[] = []

    const mockProvider = {
      id: 'mock',
      name: 'Mock',
      async *execute() {
        yield { rows: [{ name: 'Acme' }], batchIndex: 0, totalSoFar: 1 }
      },
    }

    const mockContext = {
      framework: null as any,
      intelligence: [],
      providers: { resolve: () => mockProvider } as any,
      userId: 'test',
    }

    for await (const event of skill.execute({ query: 'test' }, mockContext)) {
      events.push(event)
    }

    const resultEvents = events.filter(e => e.type === 'result')
    expect(resultEvents.length).toBeGreaterThan(0)
    expect((resultEvents[0] as any).data.rows).toEqual([{ name: 'Acme' }])
  })
})

// ---------------------------------------------------------------------------
// Registry integration — markdown skills appear alongside builtins
// ---------------------------------------------------------------------------

describe('SkillRegistry integration', () => {
  it('registers markdown skills alongside builtin skills', async () => {
    // Import the actual registry class
    const { SkillRegistry } = await import('../registry')
    const registry = new SkillRegistry()

    // Register a fake builtin
    registry.register({
      id: 'find-companies',
      name: 'Find Companies',
      version: '1.0.0',
      description: 'Find companies',
      category: 'research',
      inputSchema: {},
      outputSchema: {},
      requiredCapabilities: ['search'],
      async *execute() {},
    })

    // Register a markdown skill
    const mdDef: MarkdownSkillDefinition = {
      name: 'test-md',
      description: 'A markdown skill',
      inputs: [{ name: 'q', description: 'query' }],
      provider: 'mock',
      capabilities: ['search'],
      category: 'research',
    }
    const mdSkill = buildSkillFromDefinition(mdDef, 'Search {{q}}.')
    registry.register(mdSkill)

    // Both should appear in list
    const all = registry.list()
    expect(all.find(s => s.id === 'find-companies')).toBeDefined()
    expect(all.find(s => s.id === 'md:test-md')).toBeDefined()

    // Get by id works
    expect(registry.get('md:test-md')).toBeDefined()
    expect(registry.get('md:test-md')!.description).toBe('A markdown skill')

    // Planner string includes both
    const plannerStr = registry.getForPlanner()
    expect(plannerStr).toContain('find-companies')
    expect(plannerStr).toContain('md:test-md')
  })

  it('filters markdown skills by category', async () => {
    const { SkillRegistry } = await import('../registry')
    const registry = new SkillRegistry()

    const researchSkill = buildSkillFromDefinition(
      { name: 'md-research', description: 'Research', inputs: [], provider: 'mock', category: 'research' },
      'body',
    )
    const contentSkill = buildSkillFromDefinition(
      { name: 'md-content', description: 'Content', inputs: [], provider: 'mock', category: 'content' },
      'body',
    )

    registry.register(researchSkill)
    registry.register(contentSkill)

    expect(registry.list('research').length).toBe(1)
    expect(registry.list('content').length).toBe(1)
    expect(registry.list().length).toBe(2)
  })
})
