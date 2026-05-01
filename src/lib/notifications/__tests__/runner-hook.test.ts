/**
 * Tests for the stale-walk hook called by the runner each tick (D2).
 *
 * Covers:
 *   - awaiting gate inside the stale band → dispatched once.
 *   - awaiting gate fresh (< 80% of timeout) → not dispatched.
 *   - second tick observing the same stale gate is a no-op (flag file).
 *   - already-timed-out gates are skipped (left to enforceGateTimeouts).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import yaml from 'js-yaml'
import { CURRENT_SENTINEL_VERSION } from '../../frameworks/gates'
import type { AwaitingGateRecord } from '../../frameworks/runner'

describe('notifyStaleAwaitingGates (runner hook)', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(
      tmpdir(),
      `yalc-stalehook-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tempHome, { recursive: true })
    mkdirSync(join(tempHome, '.gtm-os'), { recursive: true })
    process.env.HOME = tempHome
    // Force config so desktop is on regardless of platform under test.
    writeFileSync(
      join(tempHome, '.gtm-os', 'config.yaml'),
      // Disable both channels so the hook is a pure flag-file check —
      // tests run on darwin would otherwise pop real macOS notifications.
      yaml.dump({ notifications: { slack: false, desktop: false } }),
      'utf-8',
    )
    vi.resetModules()
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
    vi.resetModules()
  })

  function seedAwaiting(framework: string, runId: string, createdAtIso: string) {
    const dir = join(tempHome, '.gtm-os', 'agents', `${framework}.runs`)
    mkdirSync(dir, { recursive: true })
    const record: AwaitingGateRecord = {
      _v: CURRENT_SENTINEL_VERSION,
      run_id: runId,
      framework,
      step_index: 1,
      gate_id: 'review',
      prompt: 'Approve?',
      payload: null,
      payload_step_index: null,
      prior_step_outputs: [],
      inputs: {},
      created_at: createdAtIso,
    }
    writeFileSync(
      join(dir, `${runId}.awaiting-gate.json`),
      JSON.stringify(record, null, 2),
      'utf-8',
    )
    return record
  }

  it('fires once for a stale (90% elapsed) awaiting gate', async () => {
    // 72h default timeout × 0.9 = 64.8h elapsed.
    const now = Date.parse('2026-04-30T12:00:00.000Z')
    const created = new Date(now - 65 * 3600 * 1000).toISOString()
    seedAwaiting('demo-fw', 'rid-1', created)
    const { notifyStaleAwaitingGates } = await import('../runner-hook')
    // Patch the index.ts dispatch to use our injectable senders by setting
    // the platform to darwin so the desktop branch fires, and stubbing
    // exec via re-importing index. Simpler: monkey-patch fetch (not used)
    // and replace the desktopSender via a wrapper in dispatch — but the
    // hook calls notifyStaleGate without options. So instead we mock the
    // index.ts surface.
    // Re-import index to grab the live notifyStaleGate and verify the
    // flag file appears as a side-effect.
    const idem = await import('../idempotency')
    expect(idem.listFlags()).toEqual([])
    await notifyStaleAwaitingGates(now)
    // Flag file recorded.
    const flags = idem.listFlags()
    expect(flags.length).toBe(1)
    expect(flags[0]).toMatch(/\.stale\.flag$/)
  })

  it('does not fire for a fresh (10% elapsed) awaiting gate', async () => {
    const now = Date.parse('2026-04-30T12:00:00.000Z')
    const created = new Date(now - 7 * 3600 * 1000).toISOString()
    seedAwaiting('demo-fw', 'rid-2', created)
    const { notifyStaleAwaitingGates } = await import('../runner-hook')
    const { listFlags } = await import('../idempotency')
    await notifyStaleAwaitingGates(now)
    expect(listFlags()).toEqual([])
  })

  it('skips already-timed-out gates (left to enforceGateTimeouts)', async () => {
    const now = Date.parse('2026-04-30T12:00:00.000Z')
    // 100h elapsed > 72h timeout.
    const created = new Date(now - 100 * 3600 * 1000).toISOString()
    seedAwaiting('demo-fw', 'rid-3', created)
    const { notifyStaleAwaitingGates } = await import('../runner-hook')
    const { listFlags } = await import('../idempotency')
    await notifyStaleAwaitingGates(now)
    expect(listFlags()).toEqual([])
  })

  it('second tick observes the same stale gate as a no-op', async () => {
    const now = Date.parse('2026-04-30T12:00:00.000Z')
    const created = new Date(now - 65 * 3600 * 1000).toISOString()
    seedAwaiting('demo-fw', 'rid-4', created)
    const { notifyStaleAwaitingGates } = await import('../runner-hook')
    const { listFlags } = await import('../idempotency')
    await notifyStaleAwaitingGates(now)
    const after1 = listFlags().length
    await notifyStaleAwaitingGates(now)
    const after2 = listFlags().length
    expect(after1).toBe(1)
    expect(after2).toBe(1)
  })
})
