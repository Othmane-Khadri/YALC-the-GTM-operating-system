import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isClaudeCode,
  getWebFetchProvider,
  getWebSearchProvider,
  CLAUDE_CODE_ENV_MARKERS,
} from '../claude-code'

const ENV_KEYS = [
  ...CLAUDE_CODE_ENV_MARKERS,
  'WEB_FETCH_PROVIDER',
  'WEB_SEARCH_PROVIDER',
  'FIRECRAWL_API_KEY',
] as const

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

describe('isClaudeCode', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    clearEnv()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns false when no markers are set', () => {
    expect(isClaudeCode()).toBe(false)
  })

  it('returns true when CLAUDECODE is set', () => {
    process.env.CLAUDECODE = '1'
    expect(isClaudeCode()).toBe(true)
  })
})

describe('getWebFetchProvider', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    clearEnv()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns firecrawl when key is present (auto)', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test'
    expect(getWebFetchProvider()).toBe('firecrawl')
  })

  it('returns claude-code when inside CC without firecrawl', () => {
    process.env.CLAUDECODE = '1'
    expect(getWebFetchProvider()).toBe('claude-code')
  })

  it('returns none when nothing is configured', () => {
    expect(getWebFetchProvider()).toBe('none')
  })

  it('honors explicit WEB_FETCH_PROVIDER=firecrawl when key missing', () => {
    process.env.WEB_FETCH_PROVIDER = 'firecrawl'
    process.env.CLAUDECODE = '1'
    expect(getWebFetchProvider()).toBe('none')
  })
})

describe('getWebSearchProvider', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k]
    clearEnv()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('returns firecrawl when key is present (auto)', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test'
    expect(getWebSearchProvider()).toBe('firecrawl')
  })

  it('returns claude-code when inside CC without firecrawl', () => {
    process.env.CLAUDECODE = '1'
    expect(getWebSearchProvider()).toBe('claude-code')
  })

  it('returns none when nothing is configured', () => {
    expect(getWebSearchProvider()).toBe('none')
  })

  it('honors explicit WEB_SEARCH_PROVIDER=claude-code outside CC', () => {
    process.env.WEB_SEARCH_PROVIDER = 'claude-code'
    expect(getWebSearchProvider()).toBe('none')
  })

  it('honors explicit WEB_SEARCH_PROVIDER=firecrawl with key', () => {
    process.env.WEB_SEARCH_PROVIDER = 'firecrawl'
    process.env.FIRECRAWL_API_KEY = 'fc-test'
    expect(getWebSearchProvider()).toBe('firecrawl')
  })

  it('is independent of WEB_FETCH_PROVIDER', () => {
    process.env.WEB_FETCH_PROVIDER = 'claude-code'
    process.env.FIRECRAWL_API_KEY = 'fc-test'
    // search auto picks firecrawl since key is present, even though fetch was overridden.
    expect(getWebSearchProvider()).toBe('firecrawl')
  })
})
