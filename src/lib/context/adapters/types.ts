/**
 * Context adapter interface — Phase 1 / C1.
 *
 * Adapters are the pluggable bridges that pull external content into a
 * tenant's memory layer. Each adapter:
 *   - reports whether it is available for a given tenant (config present)
 *   - can do a one-shot sync (returns counts of add/update/remove)
 *   - optionally supports live watching (returns an unsubscribe fn)
 *
 * Phase 1 ships one concrete adapter: `markdown-folder`. Future adapters
 * (Notion workspace, Google Drive, URL list) implement the same shape.
 */

export interface SyncResult {
  added: number
  updated: number
  removed: number
  unchanged: number
}

export type UnsubscribeFn = () => Promise<void> | void

export interface ContextAdapter {
  readonly id: string
  /** Returns true when this adapter has valid config for the tenant. */
  isAvailable(tenantId: string): Promise<boolean> | boolean
  /** Pull the latest state and upsert into memory. Safe to call repeatedly. */
  sync(tenantId: string): Promise<SyncResult>
  /** Optional live-watch; implementations should debounce their own events. */
  watch?(tenantId: string): Promise<UnsubscribeFn> | UnsubscribeFn
}
