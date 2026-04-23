import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { csvAdapter, jsonAdapter } from '../adapters/csv'
import { webhookAdapter } from '../adapters/webhook'
import { sequencerCsvAdapter } from '../adapters/sequencer-csv'
import { ExportRegistry, createDefaultRegistry } from '../registry'
import type { ExportOptions } from '../types'

// ─── Test Data ──────────────────────────────────────────────────────────────

const SAMPLE_DATA = [
  { first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com', company: 'Acme Inc', title: 'VP Sales', linkedin_url: 'https://linkedin.com/in/alice' },
  { first_name: 'Bob', last_name: 'Jones', email: 'bob@example.com', company: 'Beta Corp', title: 'CTO', linkedin_url: 'https://linkedin.com/in/bob' },
  { first_name: 'Carol', last_name: 'White', email: 'carol@example.com', company: 'Gamma Ltd', title: 'CEO', linkedin_url: 'https://linkedin.com/in/carol' },
]

function tmpPath(name: string): string {
  return join(tmpdir(), `gtm-os-test-${Date.now()}-${name}`)
}

// ─── CSV Adapter ────────────────────────────────────────────────────────────

describe('CSV Adapter', () => {
  let outPath: string

  afterEach(() => {
    if (outPath && existsSync(outPath)) unlinkSync(outPath)
  })

  it('exports all fields with correct headers', async () => {
    outPath = tmpPath('all.csv')
    const result = await csvAdapter.export(SAMPLE_DATA, { destination: outPath })

    expect(result.success).toBe(true)
    expect(result.recordsExported).toBe(3)

    const content = readFileSync(outPath, 'utf-8')
    const lines = content.split('\n')
    expect(lines[0]).toBe('first_name,last_name,email,company,title,linkedin_url')
    expect(lines.length).toBe(4) // header + 3 rows
    expect(lines[1]).toContain('Alice')
  })

  it('respects field selection', async () => {
    outPath = tmpPath('fields.csv')
    const result = await csvAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      fields: ['email', 'first_name'],
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const lines = content.split('\n')
    expect(lines[0]).toBe('email,first_name')
    expect(lines[1]).toBe('alice@example.com,Alice')
  })

  it('escapes commas and quotes in values', async () => {
    outPath = tmpPath('escape.csv')
    const data = [{ name: 'O\'Brien, Jr.', note: 'said "hello"' }]
    const result = await csvAdapter.export(data, { destination: outPath })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    expect(content).toContain('"O\'Brien, Jr."')
    expect(content).toContain('"said ""hello"""')
  })

  it('auto-generates filename when destination is empty', async () => {
    const dir = tmpdir()
    const result = await csvAdapter.export(SAMPLE_DATA, { destination: dir + '/' })

    expect(result.success).toBe(true)
    expect(result.destination).toMatch(/export_\d{8}_3\.csv$/)
    outPath = result.destination
  })

  it('handles empty data', async () => {
    const result = await csvAdapter.export([], { destination: '' })
    expect(result.success).toBe(true)
    expect(result.recordsExported).toBe(0)
  })
})

// ─── JSON Adapter ───────────────────────────────────────────────────────────

describe('JSON Adapter', () => {
  let outPath: string

  afterEach(() => {
    if (outPath && existsSync(outPath)) unlinkSync(outPath)
  })

  it('exports valid JSON', async () => {
    outPath = tmpPath('export.json')
    const result = await jsonAdapter.export(SAMPLE_DATA, { destination: outPath })

    expect(result.success).toBe(true)
    expect(result.recordsExported).toBe(3)

    const content = readFileSync(outPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(3)
    expect(parsed[0].email).toBe('alice@example.com')
  })

  it('respects field selection', async () => {
    outPath = tmpPath('fields.json')
    await jsonAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      fields: ['email'],
    })

    const parsed = JSON.parse(readFileSync(outPath, 'utf-8'))
    expect(Object.keys(parsed[0])).toEqual(['email'])
  })
})

// ─── Webhook Adapter ────────────────────────────────────────────────────────

describe('Webhook Adapter', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends batch POST with correct body', async () => {
    let capturedBody: unknown
    let capturedHeaders: Record<string, string> = {}

    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string)
      capturedHeaders = Object.fromEntries(
        Object.entries(init?.headers as Record<string, string>),
      )
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    const result = await webhookAdapter.export(SAMPLE_DATA, {
      destination: 'https://hook.example.com/ingest',
    })

    expect(result.success).toBe(true)
    expect(result.recordsExported).toBe(3)
    expect((capturedBody as any).count).toBe(3)
    expect((capturedBody as any).records.length).toBe(3)
    expect(capturedHeaders['Content-Type']).toBe('application/json')
  })

  it('retries on 429', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts++
      if (attempts < 3) return new Response('rate limited', { status: 429 })
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    const result = await webhookAdapter.export([SAMPLE_DATA[0]], {
      destination: 'https://hook.example.com/ingest',
    })

    expect(result.success).toBe(true)
    expect(attempts).toBe(3)
  })

  it('retries on 5xx', async () => {
    let attempts = 0
    globalThis.fetch = vi.fn(async () => {
      attempts++
      if (attempts === 1) return new Response('error', { status: 502 })
      return new Response('OK', { status: 200 })
    }) as typeof fetch

    const result = await webhookAdapter.export([SAMPLE_DATA[0]], {
      destination: 'https://hook.example.com/ingest',
    })

    expect(result.success).toBe(true)
    expect(attempts).toBe(2)
  })

  it('fails on non-retryable status', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response('bad request', { status: 400 })
    }) as typeof fetch

    const result = await webhookAdapter.export(SAMPLE_DATA, {
      destination: 'https://hook.example.com/ingest',
    })

    expect(result.success).toBe(false)
    expect(result.errors).toBeDefined()
    expect(result.errors![0]).toContain('400')
  })

  it('requires URL', async () => {
    const result = await webhookAdapter.export(SAMPLE_DATA, { destination: '' })
    expect(result.success).toBe(false)
    expect(result.errors![0]).toContain('URL required')
  })
})

// ─── Sequencer CSV Adapter ──────────────────────────────────────────────────

describe('Sequencer CSV Adapter', () => {
  let outPath: string

  afterEach(() => {
    if (outPath && existsSync(outPath)) unlinkSync(outPath)
  })

  it('exports Lemlist format with exact headers', async () => {
    outPath = tmpPath('lemlist.csv')
    const result = await sequencerCsvAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      format: 'lemlist',
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const lines = content.split('\n')
    expect(lines[0]).toBe('first_name,last_name,email,companyName,linkedinUrl,icebreaker')
    expect(lines[1]).toContain('Alice')
    expect(lines[1]).toContain('Acme Inc')
  })

  it('exports Apollo format with exact headers', async () => {
    outPath = tmpPath('apollo.csv')
    const result = await sequencerCsvAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      format: 'apollo',
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const header = content.split('\n')[0]
    expect(header).toBe('first_name,last_name,email,organization_name,title,linkedin_url')
  })

  it('exports Woodpecker format with exact headers', async () => {
    outPath = tmpPath('woodpecker.csv')
    const result = await sequencerCsvAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      format: 'woodpecker',
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const header = content.split('\n')[0]
    expect(header).toBe('first_name,last_name,email,company,website,snippet')
  })

  it('fills empty string for missing fields', async () => {
    outPath = tmpPath('missing.csv')
    // Data has no 'icebreaker' or 'website' fields
    const result = await sequencerCsvAdapter.export(SAMPLE_DATA, {
      destination: outPath,
      format: 'lemlist',
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const row = content.split('\n')[1]
    // Last field (icebreaker) should be empty
    expect(row.endsWith(',')).toBe(true)
  })

  it('rejects unknown format', async () => {
    const result = await sequencerCsvAdapter.export(SAMPLE_DATA, {
      destination: '',
      format: 'unknown-tool',
    })

    expect(result.success).toBe(false)
    expect(result.errors![0]).toContain('Unknown sequencer format')
  })

  it('maps alternate field names correctly', async () => {
    outPath = tmpPath('alt-names.csv')
    // Use different naming conventions
    const altData = [
      { firstName: 'Dan', lastName: 'Brown', email: 'dan@test.com', companyName: 'TestCo', profile_url: 'https://li.com/dan' },
    ]
    const result = await sequencerCsvAdapter.export(altData, {
      destination: outPath,
      format: 'apollo',
    })

    expect(result.success).toBe(true)
    const content = readFileSync(outPath, 'utf-8')
    const row = content.split('\n')[1]
    expect(row).toContain('Dan')
    expect(row).toContain('Brown')
    expect(row).toContain('TestCo')
    expect(row).toContain('https://li.com/dan')
  })
})

// ─── Export Registry ────────────────────────────────────────────────────────

describe('ExportRegistry', () => {
  it('registers and resolves adapters', () => {
    const registry = new ExportRegistry()
    registry.register(csvAdapter)

    expect(registry.get('csv')).toBe(csvAdapter)
    expect(registry.get('nonexistent')).toBeNull()
  })

  it('lists all registered adapters', () => {
    const registry = new ExportRegistry()
    registry.register(csvAdapter)
    registry.register(jsonAdapter)

    const list = registry.list()
    expect(list.length).toBe(2)
    expect(list.map(a => a.id)).toContain('csv')
    expect(list.map(a => a.id)).toContain('json')
  })

  it('checks existence with has()', () => {
    const registry = new ExportRegistry()
    registry.register(webhookAdapter)

    expect(registry.has('webhook')).toBe(true)
    expect(registry.has('csv')).toBe(false)
  })

  it('createDefaultRegistry loads all built-in adapters', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('csv')).toBe(true)
    expect(registry.has('json')).toBe(true)
    expect(registry.has('google-sheets')).toBe(true)
    expect(registry.has('webhook')).toBe(true)
    expect(registry.has('sequencer-csv')).toBe(true)
    expect(registry.list().length).toBe(5)
  })
})
