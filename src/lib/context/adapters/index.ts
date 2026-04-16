/**
 * Adapter bootstrap — Phase 1 / C2-C3.
 *
 * Importing this file registers every built-in adapter into the
 * registry. Commands and the watcher daemon should import from here
 * (not from individual adapter files) to guarantee registration.
 */

import { registerAdapter, listAllAdapters } from './registry.js'
import { markdownFolderAdapter } from './markdown-folder.js'

let bootstrapped = false

function bootstrap(): void {
  if (bootstrapped) return
  bootstrapped = true
  // Only register if not already in the map — makes repeated imports safe
  // during vitest's singleton-per-process module graph.
  const existing = new Set(listAllAdapters().map((a) => a.id))
  if (!existing.has(markdownFolderAdapter.id)) registerAdapter(markdownFolderAdapter)
}

bootstrap()

export { listAllAdapters, listAvailableAdapters, getAdapter } from './registry.js'
export type { ContextAdapter, SyncResult, UnsubscribeFn } from './types.js'
