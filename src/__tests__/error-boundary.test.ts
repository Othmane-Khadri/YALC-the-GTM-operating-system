import { describe, it, expect, beforeEach } from 'vitest'
import { formatError, setVerbose, isVerbose } from '../lib/cli/error-boundary'
import { classifyError } from '../lib/diagnostics/error-handler'

/**
 * Tests for the CLI error boundary and error classification.
 */

describe('formatError', () => {
  it('formats ECONNREFUSED errors as provider unreachable', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:443')
    const msg = formatError(err)
    expect(msg).toContain('unreachable')
  })

  it('formats ENOTFOUND errors with host info', () => {
    const err = new Error('getaddrinfo ENOTFOUND api.crustdata.com')
    const msg = formatError(err)
    expect(msg).toContain('unreachable')
    expect(msg).toContain('crustdata')
  })

  it('formats 401 errors as auth failure', () => {
    const err = new Error('Request failed with status 401 Unauthorized from Anthropic API')
    const msg = formatError(err)
    expect(msg).toContain('authentication failed')
  })

  it('defers 429 errors to diagnostic classifier (returns empty)', () => {
    // "Rate limit exceeded" matches the diagnostic classifier (PRV_007),
    // so formatError returns empty to let withDiagnostics handle it.
    const err = new Error('Rate limit exceeded 429 from Notion API')
    const msg = formatError(err)
    expect(msg).toBe('')
  })

  it('formats timeout errors cleanly', () => {
    const err = new Error('Request to unipile timeout after 10000ms')
    const msg = formatError(err)
    expect(msg).toContain('timed out')
  })

  it('returns generic message for unknown errors', () => {
    const err = new Error('Something unexpected happened')
    const msg = formatError(err)
    expect(msg).toContain('Something unexpected happened')
  })
})

describe('classifyError', () => {
  it('classifies missing ANTHROPIC_API_KEY', () => {
    const err = new Error('ANTHROPIC_API_KEY must be set')
    const diagnostic = classifyError(err)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.code).toBe('ENV_001')
  })

  it('classifies SQLITE_CANTOPEN', () => {
    const err = new Error('SQLITE_CANTOPEN: unable to open database')
    const diagnostic = classifyError(err)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.code).toBe('DB_001')
  })

  it('classifies ProviderNotFoundError', () => {
    const err = new Error("ProviderNotFoundError: Provider 'xyz' not found")
    const diagnostic = classifyError(err)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.code).toBe('PRV_006')
  })

  it('classifies rate limit errors', () => {
    const err = new Error('Rate limit exceeded for Crustdata API')
    const diagnostic = classifyError(err)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.code).toBe('PRV_007')
  })

  it('classifies Notion body too large', () => {
    const err = new Error('Request body too large')
    const diagnostic = classifyError(err)
    expect(diagnostic).not.toBeNull()
    expect(diagnostic!.code).toBe('RT_001')
  })

  it('returns null for unrecognized errors', () => {
    const err = new Error('Random unknown error')
    const diagnostic = classifyError(err)
    expect(diagnostic).toBeNull()
  })
})

describe('verbose flag', () => {
  beforeEach(() => {
    setVerbose(false)
    delete process.env.DEBUG
    delete process.env.GTM_OS_DEBUG
  })

  it('defaults to false', () => {
    expect(isVerbose()).toBe(false)
  })

  it('can be set to true', () => {
    setVerbose(true)
    expect(isVerbose()).toBe(true)
  })

  it('respects DEBUG env var', () => {
    process.env.DEBUG = '1'
    expect(isVerbose()).toBe(true)
  })

  it('respects GTM_OS_DEBUG env var', () => {
    process.env.GTM_OS_DEBUG = '1'
    expect(isVerbose()).toBe(true)
  })
})
