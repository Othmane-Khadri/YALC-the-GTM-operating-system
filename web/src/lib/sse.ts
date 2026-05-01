/**
 * Tiny EventSource wrapper for live SSE on /today and /visualizations (C5).
 *
 * Behaviour:
 *   - Opens an `EventSource` against the supplied URL.
 *   - Dispatches each named event to `handlers[eventName]` with the parsed
 *     JSON payload (or raw string when not JSON).
 *   - On disconnect, reconnects with exponential backoff capped at 30s and
 *     calls `onReconnect` once the new connection opens — the page uses
 *     this to re-fetch the full feed before resuming live splices, so any
 *     event emitted during the offline window is recovered.
 *
 * Returns a `close()` function that tears down the current connection and
 * prevents further reconnect attempts.
 */

export type SseHandler = (data: unknown) => void

export interface SseClientOptions {
  /** Map of event name → handler. Unknown events are ignored. */
  handlers: Record<string, SseHandler>
  /** Called once after every (re)connect. Use to resync local state. */
  onReconnect?: () => void
  /** Optional EventSource constructor — overridable for tests. */
  EventSourceImpl?: typeof EventSource
  /** Optional setTimeout — overridable for tests (mock timers). */
  setTimeoutImpl?: typeof setTimeout
  /** Initial backoff in ms (default 500ms). */
  initialBackoffMs?: number
  /** Maximum backoff in ms (default 30_000ms). */
  maxBackoffMs?: number
}

export interface SseClient {
  /** Close the connection and stop reconnect attempts. */
  close(): void
}

/**
 * Open an SSE connection. The first connect is fired synchronously; on
 * `error`, the connection is closed and a backoff timer is scheduled.
 */
export function openSseClient(url: string, opts: SseClientOptions): SseClient {
  const ESCtor =
    opts.EventSourceImpl ??
    (typeof EventSource !== 'undefined' ? EventSource : undefined)
  if (!ESCtor) {
    throw new Error('EventSource is not available in this environment')
  }
  const setTo = opts.setTimeoutImpl ?? setTimeout
  const initial = opts.initialBackoffMs ?? 500
  const max = opts.maxBackoffMs ?? 30_000

  let closed = false
  let current: EventSource | null = null
  let attempt = 0
  // Track the pending reconnect so close() can clear it. We don't strictly
  // need this for correctness (the closed flag short-circuits), but it
  // surfaces a cleaner shutdown path for tests.
  let timer: ReturnType<typeof setTimeout> | null = null

  const connect = () => {
    if (closed) return
    let es: EventSource
    try {
      es = new ESCtor(url)
    } catch {
      scheduleReconnect()
      return
    }
    current = es
    es.onopen = () => {
      // Reset backoff once the server confirms the new connection.
      attempt = 0
      try {
        opts.onReconnect?.()
      } catch {
        // best-effort
      }
    }
    es.onerror = () => {
      // EventSource auto-reconnects in some browsers, but we want full
      // control over the backoff cadence — close it ourselves.
      try {
        es.close()
      } catch {
        // best-effort
      }
      if (current === es) current = null
      scheduleReconnect()
    }
    for (const [name, handler] of Object.entries(opts.handlers)) {
      es.addEventListener(name, (ev: MessageEvent) => {
        let data: unknown = ev.data
        if (typeof ev.data === 'string') {
          try {
            data = JSON.parse(ev.data)
          } catch {
            data = ev.data
          }
        }
        try {
          handler(data)
        } catch {
          // Handler errors must not break the stream.
        }
      })
    }
  }

  const scheduleReconnect = () => {
    if (closed) return
    // Exponential backoff: 500, 1000, 2000, ... capped at max (30s).
    const delay = Math.min(max, initial * Math.pow(2, attempt))
    attempt += 1
    timer = setTo(connect, delay)
  }

  connect()

  return {
    close() {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (current) {
        try {
          current.close()
        } catch {
          // best-effort
        }
        current = null
      }
    },
  }
}
