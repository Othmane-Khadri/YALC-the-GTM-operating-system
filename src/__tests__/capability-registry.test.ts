import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  CapabilityRegistry,
  CapabilityUnsatisfied,
  type CapabilityAdapter,
} from '../lib/providers/capabilities'

function makeAdapter(
  capabilityId: string,
  providerId: string,
  available: boolean,
  result: unknown = { ok: true },
): CapabilityAdapter {
  return {
    capabilityId,
    providerId,
    isAvailable: () => available,
    async execute() {
      return result
    },
  }
}

describe('CapabilityRegistry', () => {
  let prevHome: string | undefined
  let tempHome: string

  beforeEach(() => {
    prevHome = process.env.HOME
    tempHome = join(tmpdir(), `yalc-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempHome, { recursive: true })
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = prevHome
    if (existsSync(tempHome)) rmSync(tempHome, { recursive: true, force: true })
  })

  it('registers a capability and an adapter, then resolves it', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo cap',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA'],
    })
    reg.register(makeAdapter('demo', 'providerA', true))
    const resolved = await reg.resolve('demo')
    expect(resolved.providerId).toBe('providerA')
  })

  it('honors priority order — first installed wins', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA', 'providerB'],
    })
    reg.register(makeAdapter('demo', 'providerA', false))
    reg.register(makeAdapter('demo', 'providerB', true))
    const resolved = await reg.resolve('demo')
    expect(resolved.providerId).toBe('providerB')
  })

  it('throws CapabilityUnsatisfied with the priority list when nothing matches', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA', 'providerB'],
    })
    reg.register(makeAdapter('demo', 'providerA', false))
    reg.register(makeAdapter('demo', 'providerB', false))
    await expect(reg.resolve('demo')).rejects.toBeInstanceOf(CapabilityUnsatisfied)
    try {
      await reg.resolve('demo')
    } catch (err) {
      const e = err as CapabilityUnsatisfied
      expect(e.tried).toEqual(['providerA', 'providerB'])
      expect(e.message).toContain('providerA')
      expect(e.message).toContain('providerB')
    }
  })

  it('uses the capability default priority when no config.yaml exists', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA', 'providerB'],
    })
    reg.register(makeAdapter('demo', 'providerA', true))
    reg.register(makeAdapter('demo', 'providerB', true))
    const resolved = await reg.resolve('demo')
    expect(resolved.providerId).toBe('providerA')
  })

  it('honors a config.yaml priority override', async () => {
    const cfgDir = join(tempHome, '.gtm-os')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(
      join(cfgDir, 'config.yaml'),
      'capabilities:\n  demo:\n    priority: [providerB, providerA]\n',
      'utf-8',
    )
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA', 'providerB'],
    })
    reg.register(makeAdapter('demo', 'providerA', true))
    reg.register(makeAdapter('demo', 'providerB', true))
    const resolved = await reg.resolve('demo')
    expect(resolved.providerId).toBe('providerB')
  })

  it('throws on a malformed priority array in config.yaml', async () => {
    const cfgDir = join(tempHome, '.gtm-os')
    mkdirSync(cfgDir, { recursive: true })
    writeFileSync(
      join(cfgDir, 'config.yaml'),
      'capabilities:\n  demo:\n    priority: "not-an-array"\n',
      'utf-8',
    )
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA'],
    })
    reg.register(makeAdapter('demo', 'providerA', true))
    await expect(reg.resolve('demo')).rejects.toThrow(/expected array/)
  })

  it('throws CapabilityUnsatisfied with empty tried[] when the default priority list is empty', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: [],
    })
    await expect(reg.resolve('demo')).rejects.toBeInstanceOf(CapabilityUnsatisfied)
  })

  it('respects HOME isolation — a config.yaml under a different HOME is not read', async () => {
    const otherHome = join(tmpdir(), `yalc-cap-other-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(otherHome, '.gtm-os'), { recursive: true })
    writeFileSync(
      join(otherHome, '.gtm-os', 'config.yaml'),
      'capabilities:\n  demo:\n    priority: [providerB]\n',
      'utf-8',
    )
    try {
      // HOME is `tempHome`, not `otherHome`. The capability registry should
      // resolve via the default priority (providerA).
      const reg = new CapabilityRegistry()
      reg.registerCapability({
        id: 'demo',
        description: 'demo',
        inputSchema: {},
        outputSchema: {},
        defaultPriority: ['providerA', 'providerB'],
      })
      reg.register(makeAdapter('demo', 'providerA', true))
      reg.register(makeAdapter('demo', 'providerB', true))
      const resolved = await reg.resolve('demo')
      expect(resolved.providerId).toBe('providerA')
    } finally {
      rmSync(otherHome, { recursive: true, force: true })
    }
  })

  it('idempotent register — registering the same adapter twice still resolves', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA'],
    })
    const a = makeAdapter('demo', 'providerA', true, { v: 1 })
    reg.register(a)
    reg.register(a)
    const resolved = await reg.resolve('demo')
    expect(await resolved.execute({}, { executor: null, registry: null as never })).toEqual({ v: 1 })
  })

  it('double-register same provider id — later wins (replaces previous)', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['providerA'],
    })
    reg.register(makeAdapter('demo', 'providerA', true, { v: 'first' }))
    reg.register(makeAdapter('demo', 'providerA', true, { v: 'second' }))
    const resolved = await reg.resolve('demo')
    expect(await resolved.execute({}, { executor: null, registry: null as never })).toEqual({ v: 'second' })
  })

  it('unknown capability id throws CapabilityUnsatisfied', async () => {
    const reg = new CapabilityRegistry()
    await expect(reg.resolve('does-not-exist')).rejects.toBeInstanceOf(CapabilityUnsatisfied)
  })

  it('large priority list — picks the first matching adapter and skips missing/unavailable ones', async () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'demo',
      description: 'demo',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['p1', 'p2', 'p3', 'p4', 'p5'],
    })
    // p1: registered but unavailable
    reg.register(makeAdapter('demo', 'p1', false))
    // p2: not registered at all
    // p3: registered + available — should win
    reg.register(makeAdapter('demo', 'p3', true, { winner: 'p3' }))
    // p4, p5 also available, but lower priority
    reg.register(makeAdapter('demo', 'p4', true))
    reg.register(makeAdapter('demo', 'p5', true))
    const resolved = await reg.resolve('demo')
    expect(resolved.providerId).toBe('p3')
  })

  it('listAdapters returns only adapters for the requested capability', () => {
    const reg = new CapabilityRegistry()
    reg.registerCapability({
      id: 'a',
      description: '',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['x'],
    })
    reg.registerCapability({
      id: 'b',
      description: '',
      inputSchema: {},
      outputSchema: {},
      defaultPriority: ['y'],
    })
    reg.register(makeAdapter('a', 'x', true))
    reg.register(makeAdapter('b', 'y', true))
    expect(reg.listAdapters('a').map((ad) => ad.providerId)).toEqual(['x'])
    expect(reg.listAdapters('b').map((ad) => ad.providerId)).toEqual(['y'])
    expect(reg.listAdapters('missing')).toEqual([])
  })
})
