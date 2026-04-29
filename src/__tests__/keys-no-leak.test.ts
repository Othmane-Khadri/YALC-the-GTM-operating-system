/**
 * Guard against keys leaking through console/log output during the
 * /api/keys/save flow (0.9.D).
 *
 * The endpoint masks any field whose name reads like a secret before
 * returning, and the route itself doesn't log on the happy path. This
 * test pins both contracts: it captures stdout/stderr while a save
 * round-trips, and asserts the opaque value never appears in either.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string
let logSpy: ReturnType<typeof vi.spyOn>
let errSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>
let captured: string[]

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-keys-noleak-'))
  vi.stubEnv('HOME', TMP)
  vi.resetModules()
  captured = []
  const sink = (...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  }
  logSpy = vi.spyOn(console, 'log').mockImplementation(sink)
  errSpy = vi.spyOn(console, 'error').mockImplementation(sink)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(sink)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
})

describe('keys:save flow does not leak the user-supplied value', () => {
  it('the opaque value never appears in console output or response body', async () => {
    const opaque = 'unit-test-placeholder-deadbeef'
    const knowledgeModule = await import('../lib/providers/knowledge-base')
    vi.spyOn(knowledgeModule, 'loadProviderKnowledge').mockReturnValue(
      new Map([
        [
          'crustdata',
          {
            id: 'crustdata',
            display_name: 'Crustdata',
            integration_kind: 'rest',
            env_vars: [
              {
                name: 'CRUSTDATA_API_KEY',
                description: '',
                example: '',
                required: true,
              },
            ],
            capabilities_supported: [],
            install_steps: [],
          },
        ],
      ]) as never,
    )
    const { createApp } = await import('../lib/server/index')
    const app = createApp()

    const res = await app.request('/api/keys/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'crustdata', env: { CRUSTDATA_API_KEY: opaque } }),
    })
    expect(res.status).toBe(200)
    const text = await res.text()
    // The response shape masks any field that reads like a secret. The
    // opaque value never round-trips into the body.
    expect(text).not.toContain(opaque)

    // Captured stdout/stderr/warn — the value never lands in any logger.
    expect(captured.join('\n')).not.toContain(opaque)

    // Touch the spies so vitest doesn't report them as unused.
    expect(logSpy).toBeDefined()
    expect(errSpy).toBeDefined()
    expect(warnSpy).toBeDefined()
  })
})
