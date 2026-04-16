/**
 * Watcher daemon — Phase 1 / C3.
 *
 * Runs all enabled adapters for one tenant in a single long-running
 * process. Each adapter gets one initial sync and then an optional
 * watch() subscription. SIGINT unsubscribes everything cleanly and
 * resolves the returned promise.
 */

import { listAvailableAdapters } from './adapters/index.js'
import type { UnsubscribeFn } from './adapters/types.js'

export interface WatcherDaemonOptions {
  tenantId: string
  /** Skip the initial sync pass before watching. Default false. */
  skipInitialSync?: boolean
  /** Log hook for tests; defaults to console.log. */
  log?: (line: string) => void
}

export async function runWatcherDaemon(opts: WatcherDaemonOptions): Promise<void> {
  const log = opts.log ?? ((line: string) => console.log(line))
  const { tenantId } = opts

  const adapters = await listAvailableAdapters(tenantId)
  if (adapters.length === 0) {
    log(`[watcher][${tenantId}] no adapters available \u2014 nothing to watch`)
    return
  }

  log(
    `[watcher][${tenantId}] starting ${adapters.length} adapter(s): ${adapters.map((a) => a.id).join(', ')}`,
  )

  // 1. Initial sync.
  if (!opts.skipInitialSync) {
    for (const adapter of adapters) {
      try {
        const result = await adapter.sync(tenantId)
        log(
          `[watcher][${tenantId}][${adapter.id}] initial sync: +${result.added} ~${result.updated} -${result.removed} =${result.unchanged}`,
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log(`[watcher][${tenantId}][${adapter.id}] initial sync error: ${msg}`)
      }
    }
  }

  // 2. Subscribe to watch handlers.
  const unsubs: UnsubscribeFn[] = []
  for (const adapter of adapters) {
    if (!adapter.watch) continue
    try {
      const unsub = await adapter.watch(tenantId)
      unsubs.push(unsub)
      log(`[watcher][${tenantId}][${adapter.id}] watching`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`[watcher][${tenantId}][${adapter.id}] watch error: ${msg}`)
    }
  }

  if (unsubs.length === 0) {
    log(`[watcher][${tenantId}] no adapter supports watch() \u2014 exiting after initial sync`)
    return
  }

  // 3. Wait for SIGINT, then shut down cleanly.
  await new Promise<void>((resolvePromise) => {
    const shutdown = async () => {
      log(`[watcher][${tenantId}] SIGINT received, shutting down`)
      for (const unsub of unsubs) {
        try {
          await unsub()
        } catch {
          // ignore
        }
      }
      process.off('SIGINT', shutdown)
      resolvePromise()
    }
    process.on('SIGINT', shutdown)
  })
}
