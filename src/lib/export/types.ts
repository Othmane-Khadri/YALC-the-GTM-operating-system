// ─── Export Adapter System — Types ──────────────────────────────────────────

/**
 * Core adapter interface. Every export destination implements this contract.
 * Adding a new export = implementing ExportAdapter + registering it.
 */
export interface ExportAdapter {
  id: string
  name: string
  description: string
  export(data: Record<string, unknown>[], options: ExportOptions): Promise<ExportResult>
}

/**
 * Options passed to every adapter's export() call.
 */
export interface ExportOptions {
  /** File path, URL, Google Sheet ID, etc. */
  destination: string
  /** Which fields to include (default: all) */
  fields?: string[]
  /** Adapter-specific format hint (e.g. 'lemlist', 'apollo', 'woodpecker') */
  format?: string
  /** Tenant scope */
  tenantId?: string
}

/**
 * Standardized result returned by every adapter.
 */
export interface ExportResult {
  success: boolean
  recordsExported: number
  destination: string
  errors?: string[]
}
