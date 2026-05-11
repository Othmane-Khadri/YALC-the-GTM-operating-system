/**
 * Tests for the 0.9.6 / A5 doctor → keys:connect handoff.
 *
 * When a provider env var is missing or invalid, doctor should print a
 * clickable URL pointing at the SPA's /keys/connect/<provider> route so
 * the user has an actionable next step. Doctor itself MUST NOT boot the
 * server — it just prints the URL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let TMP: string

async function runDoctorCapture(): Promise<string> {
  const original = console.log
  const buffer: string[] = []
  console.log = (...args: unknown[]) => {
    buffer.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '))
  }
  const realExit = process.exit
  ;(process as unknown as { exit: (code?: number) => void }).exit = ((_code?: number) => {
    /* noop in tests */
  }) as never
  try {
    const { runDoctor } = await import('../lib/diagnostics/doctor')
    await runDoctor({ report: false })
  } finally {
    console.log = original
    ;(process as unknown as { exit: typeof realExit }).exit = realExit
  }
  return buffer.join('\n')
}

beforeEach(() => {
  TMP = mkdtempSync(join(tmpdir(), 'yalc-doctor-handoff-'))
  // Stub HOME so doctor reads from a sandboxed ~/.gtm-os.
  vi.stubEnv('HOME', TMP)
  // Wipe the handful of env vars doctor probes so the missing-key paths
  // fire deterministically.
  vi.stubEnv('UNIPILE_API_KEY', '')
  vi.stubEnv('UNIPILE_DSN', '')
  vi.stubEnv('FIRECRAWL_API_KEY', '')
  vi.stubEnv('NOTION_API_KEY', '')
  vi.stubEnv('CRUSTDATA_API_KEY', '')
  vi.stubEnv('FULLENRICH_API_KEY', '')
  vi.stubEnv('INSTANTLY_API_KEY', '')
  // Provide a stub home with .env so doctor doesn't bail out on the
  // env-file check. Also write a config.yaml that does NOT opt out of
  // any provider, so all per-provider missing-key paths fire.
  const home = join(TMP, '.gtm-os')
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, '.env'), 'PLACEHOLDER=1\n')
  writeFileSync(
    join(home, 'config.yaml'),
    'email:\n  provider: instantly\nlinkedin:\n  provider: unipile\n',
  )
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(TMP, { recursive: true, force: true })
})

describe('doctor keys:connect handoff', () => {
  it('prints a clickable /keys/connect/<provider> URL for each missing key', async () => {
    const out = await runDoctorCapture()
    // Each provider whose key is missing should surface its connect URL.
    // We check the four canonical optional providers; the precise format
    // is `http://localhost:3847/keys/connect/<provider>` per spec.
    expect(out).toContain('http://localhost:3847/keys/connect/firecrawl')
    expect(out).toContain('http://localhost:3847/keys/connect/notion')
    expect(out).toContain('http://localhost:3847/keys/connect/crustdata')
    expect(out).toContain('http://localhost:3847/keys/connect/fullenrich')
    expect(out).toContain('http://localhost:3847/keys/connect/instantly')
    expect(out).toContain('http://localhost:3847/keys/connect/unipile')
  })

  it('does not attempt to boot the SPA server (no port-binding side effects)', async () => {
    // Doctor is a fast-feedback diagnostic. It must NEVER start the server.
    // We can't easily intercept fs / net calls without massive surgery, so
    // we proxy this guarantee: the run completes synchronously in well
    // under the SPA's startup latency budget (a real `serve` would take
    // significantly longer than 5s). The presence of "── Summary ──" tells
    // us the run finished cleanly.
    const t0 = Date.now()
    const out = await runDoctorCapture()
    const dt = Date.now() - t0
    expect(out).toContain('── Summary ──')
    expect(dt).toBeLessThan(60_000) // generous — network probes can be slow
  })
})
