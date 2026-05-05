/**
 * Tests for the universal ICP gate. Every CLI command that operates on a
 * tenant's leads or campaigns calls `requireClientICP()` first; the gate
 * exits the process loud-and-early when no ICP is configured.
 *
 * We mock the resolver and `process.exit` so the assertion is "did the gate
 * try to terminate?" rather than literally exiting the test runner.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../icp-source', () => ({
  resolveClientICP: vi.fn(),
  ICPSchemaError: class ICPSchemaError extends Error {
    constructor(public slug: string, public missingFields: string[], public source: 'tenant_framework' | 'repo_yaml') {
      super('schema error')
      this.name = 'ICPSchemaError'
    }
  },
}))

const { resolveClientICP, ICPSchemaError } = await import('../icp-source')
const { requireClientICP } = await import('../icp-gate')

let exitSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Cast process.exit to never to satisfy the spy, then throw so control flow
  // unwinds in tests where the gate would have terminated the process.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called')
  }) as never)
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(resolveClientICP).mockReset()
})

describe('requireClientICP', () => {
  it('returns the resolved ICP when one is configured', async () => {
    vi.mocked(resolveClientICP).mockResolvedValue({
      client_slug: 'acme',
      source: 'repo_yaml',
      primary_segment: {
        name: 'Acme primary',
        target_roles: ['CRO'],
        target_industries: ['SaaS'],
        target_company_sizes: [],
        target_geographies: [],
        disqualifiers: ['Insurance'],
        pain_points: [],
      },
    })

    const icp = await requireClientICP('test', 'acme')
    expect(icp.client_slug).toBe('acme')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('exits the process when no ICP is found for the tenant', async () => {
    vi.mocked(resolveClientICP).mockResolvedValue(null)

    await expect(requireClientICP('test', 'unknown-tenant')).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    // Operator-actionable error mentions both fix paths
    const errs = errSpy.mock.calls.flat().join('\n')
    expect(errs).toContain('no ICP configured')
    expect(errs).toContain('yalc-gtm start')
    expect(errs).toContain('clients/unknown-tenant.yml')
  })

  it('exits the process on ICPSchemaError, surfacing the missing fields', async () => {
    vi.mocked(resolveClientICP).mockRejectedValue(
      new (ICPSchemaError as unknown as new (...a: unknown[]) => Error)('acme', ['target_industries', 'disqualifiers'], 'repo_yaml'),
    )

    await expect(requireClientICP('test', 'acme')).rejects.toThrow('process.exit called')
    expect(exitSpy).toHaveBeenCalledWith(1)
    const errs = errSpy.mock.calls.flat().join('\n')
    expect(errs).toContain('Missing fields: target_industries, disqualifiers')
    expect(errs).toContain('Source: repo_yaml')
  })

  it('rethrows non-ICPSchemaError unexpected errors instead of exiting', async () => {
    vi.mocked(resolveClientICP).mockRejectedValue(new Error('disk full'))

    await expect(requireClientICP('test', 'acme')).rejects.toThrow('disk full')
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('logs a successful load with tenant + source', async () => {
    vi.mocked(resolveClientICP).mockResolvedValue({
      client_slug: 'acme',
      source: 'tenant_framework',
      primary_segment: {
        name: 'p',
        target_roles: ['CRO'],
        target_industries: ['SaaS'],
        target_company_sizes: [],
        target_geographies: [],
        disqualifiers: ['Insurance'],
        pain_points: [],
      },
    })

    await requireClientICP('campaign:create', 'acme')
    const logs = logSpy.mock.calls.flat().join('\n')
    expect(logs).toContain('[campaign:create]')
    expect(logs).toContain("ICP loaded for 'acme'")
    expect(logs).toContain('source: tenant_framework')
  })
})
