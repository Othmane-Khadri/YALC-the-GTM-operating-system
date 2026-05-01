/**
 * Tests for the /skills "Run with inputs" structured form (C6).
 *
 * The form renders one field per top-level property of the skill's
 * `inputSchema`. Pure helpers (build / validate / persist / fallback)
 * are exported separately so we can test logic without spinning up a
 * DOM — the rest of the SPA tests follow the same pattern.
 *
 * For HTML-shape assertions we render through `react-dom/server`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildFormFields,
  coerceFormValues,
  hasUnsupportedSchema,
  loadPersistedInputs,
  savePersistedInputs,
  validateFormData,
  type SkillInputSchema,
} from '../lib/skills-form'
import { SkillInputForm } from '../components/skills/SkillInputForm'

interface MemStore {
  store: Record<string, string>
}

function memoryLocalStorage(): MemStore & Storage {
  const store: Record<string, string> = {}
  return {
    store,
    get length() {
      return Object.keys(store).length
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v)
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: Storage }).localStorage = memoryLocalStorage()
})

afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage
  vi.restoreAllMocks()
})

// ─── buildFormFields ────────────────────────────────────────────────────────

describe('buildFormFields', () => {
  it('maps every supported property type to the expected control', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Free-form title' },
        homepage: { type: 'string', format: 'url' },
        contact: { type: 'string', format: 'email' },
        count: { type: 'number' },
        seats: { type: 'integer' },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['low', 'mid', 'high'] },
        filters: {
          type: 'object',
          properties: {
            industry: { type: 'string' },
          },
        },
      },
      required: ['title', 'count'],
    }

    const fields = buildFormFields(schema)
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f]))

    expect(byKey.title.control).toBe('text')
    expect(byKey.homepage.control).toBe('url')
    expect(byKey.contact.control).toBe('email')
    expect(byKey.count.control).toBe('number')
    expect(byKey.seats.control).toBe('number')
    expect(byKey.active.control).toBe('checkbox')
    expect(byKey.tags.control).toBe('csv')
    expect(byKey.priority.control).toBe('enum')
    expect(byKey.priority.options).toEqual(['low', 'mid', 'high'])
    expect(byKey.filters.control).toBe('object')
    expect(byKey.filters.children?.[0].key).toBe('industry')

    expect(byKey.title.required).toBe(true)
    expect(byKey.count.required).toBe(true)
    expect(byKey.homepage.required).toBe(false)
  })

  it('returns no fields for an empty schema', () => {
    expect(buildFormFields({ type: 'object', properties: {} })).toEqual([])
    expect(buildFormFields(undefined)).toEqual([])
  })
})

// ─── hasUnsupportedSchema ───────────────────────────────────────────────────

describe('hasUnsupportedSchema', () => {
  it('returns false for a fully supported schema', () => {
    expect(
      hasUnsupportedSchema({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'array', items: { type: 'string' } },
        },
      }),
    ).toBe(false)
  })

  it('returns true when an array of objects appears (no row UI)', () => {
    expect(
      hasUnsupportedSchema({
        type: 'object',
        properties: {
          rows: { type: 'array', items: { type: 'object' } },
        },
      }),
    ).toBe(true)
  })

  it('returns true when a property declares no recognised type', () => {
    expect(
      hasUnsupportedSchema({
        type: 'object',
        properties: {
          weird: { type: 'whatever' as unknown as string },
        },
      }),
    ).toBe(true)
  })
})

// ─── coerceFormValues + validateFormData ────────────────────────────────────

describe('coerceFormValues', () => {
  it('parses numbers, booleans, and CSV arrays from raw form state', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        count: { type: 'number' },
        active: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        title: { type: 'string' },
      },
    }
    const out = coerceFormValues(schema, {
      count: '12',
      active: true,
      tags: 'red, blue ,green',
      title: 'hello',
    })
    expect(out).toEqual({
      count: 12,
      active: true,
      tags: ['red', 'blue', 'green'],
      title: 'hello',
    })
  })

  it('drops empty optional strings and empty arrays', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    }
    const out = coerceFormValues(schema, { title: '', tags: '' })
    expect(out).toEqual({})
  })
})

describe('validateFormData', () => {
  it('flags missing required fields BEFORE submit fires', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['query'],
    }

    const errs = validateFormData(schema, {})
    expect(errs.query).toBeTruthy()
    expect(errs.count).toBeUndefined()
  })

  it('rejects malformed numbers and emails', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        n: { type: 'number' },
        contact: { type: 'string', format: 'email' },
      },
    }
    const errs = validateFormData(schema, { n: 'abc', contact: 'not-email' })
    expect(errs.n).toBeTruthy()
    expect(errs.contact).toBeTruthy()
  })

  it('passes when all values match the schema', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        n: { type: 'number' },
        contact: { type: 'string', format: 'email' },
        active: { type: 'boolean' },
      },
      required: ['n'],
    }
    const errs = validateFormData(schema, {
      n: '7',
      contact: 'a@b.co',
      active: false,
    })
    expect(Object.keys(errs)).toHaveLength(0)
  })

  it('rejects an enum value not in the option list', () => {
    const schema: SkillInputSchema = {
      type: 'object',
      properties: {
        priority: { type: 'string', enum: ['low', 'high'] },
      },
    }
    expect(validateFormData(schema, { priority: 'mid' }).priority).toBeTruthy()
    expect(
      Object.keys(validateFormData(schema, { priority: 'low' })),
    ).toHaveLength(0)
  })
})

// ─── persistence ────────────────────────────────────────────────────────────

describe('persistence', () => {
  it('round-trips the form state through localStorage keyed by skill id', () => {
    savePersistedInputs('find-companies', { query: 'fintech', count: '25' })
    const loaded = loadPersistedInputs('find-companies')
    expect(loaded).toEqual({ query: 'fintech', count: '25' })
  })

  it('returns an empty object when no entry exists', () => {
    expect(loadPersistedInputs('nope')).toEqual({})
  })

  it('isolates state across distinct skill ids', () => {
    savePersistedInputs('a', { x: '1' })
    savePersistedInputs('b', { x: '2' })
    expect(loadPersistedInputs('a')).toEqual({ x: '1' })
    expect(loadPersistedInputs('b')).toEqual({ x: '2' })
  })

  it('survives a malformed stored payload', () => {
    localStorage.setItem('yalc:skills-form:broken', 'not-json')
    expect(loadPersistedInputs('broken')).toEqual({})
  })
})

// ─── component render ───────────────────────────────────────────────────────

describe('SkillInputForm render', () => {
  it('renders a structured form with the right input types', () => {
    const html = renderToStaticMarkup(
      <SkillInputForm
        skillId="demo"
        schema={{
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text' },
            count: { type: 'number' },
            active: { type: 'boolean' },
            priority: { type: 'string', enum: ['low', 'high'] },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['query'],
        }}
        values={{}}
        errors={{}}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('data-testid="skills-input-query"')
    expect(html).toContain('data-testid="skills-input-count"')
    expect(html).toContain('type="number"')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('data-testid="skills-input-priority"')
    // Required asterisk uses the brand destructive token (no inline hex).
    expect(html).toContain('text-destructive')
    expect(html).toContain('aria-required="true"')
  })

  it('falls back to a JSON textarea when the schema has unsupported types', () => {
    const html = renderToStaticMarkup(
      <SkillInputForm
        skillId="demo"
        schema={{
          type: 'object',
          properties: {
            rows: { type: 'array', items: { type: 'object' } },
          },
        }}
        values={{}}
        errors={{}}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('data-testid="skills-form-fallback-json"')
  })

  it('falls back to JSON textarea when the schema is missing entirely', () => {
    const html = renderToStaticMarkup(
      <SkillInputForm
        skillId="demo"
        schema={undefined}
        values={{}}
        errors={{}}
        onChange={() => {}}
      />,
    )
    expect(html).toContain('data-testid="skills-form-fallback-json"')
  })
})
