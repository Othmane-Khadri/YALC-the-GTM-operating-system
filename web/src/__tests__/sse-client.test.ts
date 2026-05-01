/**
 * Tests for the SPA's SSE client wrapper (web/src/lib/sse.ts).
 *
 * Uses a fake EventSource and a controllable setTimeout so we can:
 *   - Verify each named event is dispatched to the right handler with
 *     parsed JSON.
 *   - Verify the client reconnects on `error` with exponential backoff
 *     capped at 30s.
 *   - Verify `close()` stops further reconnects.
 *   - Verify `onReconnect` fires on every successful `open`.
 *
 * Also covers the page reducer (`applyTodayEvent`) — the full Today.tsx
 * surface is tested elsewhere; this file pins the splice contract.
 */

import { describe, it, expect, vi } from 'vitest'
import { openSseClient } from '../lib/sse'
import { applyTodayEvent } from '../pages/Today'
import { applyVisualizeEvent } from '../pages/Visualizations'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {}
  closed = false
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(name: string, cb: (ev: MessageEvent) => void) {
    if (!this.listeners[name]) this.listeners[name] = []
    this.listeners[name].push(cb)
  }
  emit(name: string, data: string) {
    const ev = { data } as unknown as MessageEvent
    for (const cb of this.listeners[name] ?? []) cb(ev)
  }
  close() {
    this.closed = true
  }
  triggerOpen() {
    this.onopen?.()
  }
  triggerError() {
    this.onerror?.()
  }
}

function makeFakeTimers() {
  const queue: Array<{ id: number; delay: number; fn: () => void }> = []
  let next = 1
  const fake = ((fn: () => void, delay: number) => {
    const id = next++
    queue.push({ id, delay, fn })
    return id as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout
  return {
    fake,
    queue,
    runAll() {
      while (queue.length) {
        const { fn } = queue.shift()!
        fn()
      }
    },
    runOne() {
      const item = queue.shift()
      item?.fn()
      return item
    },
  }
}

describe('openSseClient', () => {
  it('parses JSON event data and dispatches to the named handler', () => {
    FakeEventSource.instances = []
    const handler = vi.fn()
    openSseClient('/api/today/stream', {
      handlers: { gate_awaiting: handler },
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    })
    const es = FakeEventSource.instances[0]
    expect(es).toBeDefined()
    es.triggerOpen()
    es.emit('gate_awaiting', JSON.stringify({ run_id: 'r1', framework: 'alpha' }))
    expect(handler).toHaveBeenCalledWith({ run_id: 'r1', framework: 'alpha' })
  })

  it('reconnects on error with exponential backoff capped at 30s', () => {
    FakeEventSource.instances = []
    const timers = makeFakeTimers()
    openSseClient('/api/today/stream', {
      handlers: {},
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      setTimeoutImpl: timers.fake,
      initialBackoffMs: 500,
      maxBackoffMs: 30_000,
    })
    expect(FakeEventSource.instances.length).toBe(1)

    // First disconnect → 500ms backoff.
    FakeEventSource.instances[0].triggerError()
    expect(timers.queue.length).toBe(1)
    expect(timers.queue[0].delay).toBe(500)
    timers.runOne()
    expect(FakeEventSource.instances.length).toBe(2)

    // Second disconnect → 1000ms.
    FakeEventSource.instances[1].triggerError()
    expect(timers.queue[0].delay).toBe(1000)
    timers.runOne()

    // Third → 2000ms; fourth → 4000ms; ... eventually capped at 30s.
    let lastDelay = 0
    for (let i = 0; i < 12; i++) {
      const idx = FakeEventSource.instances.length - 1
      FakeEventSource.instances[idx].triggerError()
      lastDelay = timers.queue[0].delay
      timers.runOne()
    }
    expect(lastDelay).toBeLessThanOrEqual(30_000)
    expect(lastDelay).toBe(30_000)
  })

  it('fires onReconnect on every successful open', () => {
    FakeEventSource.instances = []
    const onReconnect = vi.fn()
    const timers = makeFakeTimers()
    openSseClient('/api/today/stream', {
      handlers: {},
      onReconnect,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      setTimeoutImpl: timers.fake,
    })
    FakeEventSource.instances[0].triggerOpen()
    expect(onReconnect).toHaveBeenCalledTimes(1)
    FakeEventSource.instances[0].triggerError()
    timers.runOne()
    FakeEventSource.instances[1].triggerOpen()
    expect(onReconnect).toHaveBeenCalledTimes(2)
  })

  it('close() stops further reconnect attempts', () => {
    FakeEventSource.instances = []
    const timers = makeFakeTimers()
    const client = openSseClient('/api/today/stream', {
      handlers: {},
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
      setTimeoutImpl: timers.fake,
    })
    FakeEventSource.instances[0].triggerError()
    expect(timers.queue.length).toBe(1)
    client.close()
    timers.runAll()
    // No new EventSource created after close.
    expect(FakeEventSource.instances.length).toBe(1)
  })
})

describe('applyTodayEvent reducer', () => {
  it('upserts an awaiting_gate item by run_id', () => {
    const items = [
      {
        type: 'awaiting_gate' as const,
        framework: 'alpha',
        run_id: 'r1',
        step_index: 2,
        gate_id: 'g',
        prompt: 'old',
        payload: null,
        created_at: '2026-04-29T10:00:00Z',
      },
    ]
    const next = applyTodayEvent(items, 'gate_awaiting', {
      type: 'awaiting_gate',
      framework: 'alpha',
      run_id: 'r1',
      step_index: 2,
      gate_id: 'g',
      prompt: 'new',
      payload: null,
      created_at: '2026-04-29T11:00:00Z',
    })
    expect(next.length).toBe(1)
    expect((next[0] as { prompt: string }).prompt).toBe('new')
  })

  it('drops a matching awaiting_gate when gate_approved arrives', () => {
    const items = [
      {
        type: 'awaiting_gate' as const,
        framework: 'alpha',
        run_id: 'r1',
        step_index: 2,
        gate_id: 'g',
        prompt: 'p',
        payload: null,
        created_at: 'x',
      },
    ]
    const next = applyTodayEvent(items, 'gate_approved', { run_id: 'r1' })
    expect(next).toEqual([])
  })

  it('flips stale=true on gate_stale', () => {
    const items = [
      {
        type: 'awaiting_gate' as const,
        framework: 'alpha',
        run_id: 'r1',
        step_index: 2,
        gate_id: 'g',
        prompt: 'p',
        payload: null,
        created_at: 'x',
        stale: false,
      },
    ]
    const next = applyTodayEvent(items, 'gate_stale', { run_id: 'r1' })
    expect((next[0] as { stale: boolean }).stale).toBe(true)
  })

  it('upserts a run item by framework + ranAt', () => {
    const items: Array<Record<string, unknown>> = []
    const next = applyTodayEvent(
      items as never,
      'run_completed',
      {
        type: 'run',
        framework: 'alpha',
        title: 'alpha',
        summary: 's',
        ranAt: '2026-04-29T11:00:00Z',
        rowCount: 3,
        error: null,
        path: '/p',
      },
    )
    expect(next.length).toBe(1)
    expect((next[0] as { type: string }).type).toBe('run')
  })
})

describe('applyVisualizeEvent reducer', () => {
  it('upserts a completed visualization', () => {
    const prev = {
      items: [],
      total: 0,
      frameworks: [
        { framework: 'alpha', view_id: 'v1', intent: 'i', generated: false },
      ],
    }
    const next = applyVisualizeEvent(prev, 'visualization_completed', {
      view_id: 'v1',
      intent: 'i',
      idiom: 'kanban',
      data_paths: ['/x'],
      last_generated_at: '2026-04-30T00:00:00Z',
    })
    expect(next?.items.length).toBe(1)
    expect(next?.frameworks[0].generated).toBe(true)
  })
})
