// ─── Export Registry ────────────────────────────────────────────────────────
// Central registry for all export adapters. Register once, resolve by ID.

import type { ExportAdapter } from './types'
import { csvAdapter, jsonAdapter } from './adapters/csv'
import { googleSheetsAdapter } from './adapters/google-sheets'
import { webhookAdapter } from './adapters/webhook'
import { sequencerCsvAdapter } from './adapters/sequencer-csv'

export class ExportRegistry {
  private adapters = new Map<string, ExportAdapter>()

  register(adapter: ExportAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  get(id: string): ExportAdapter | null {
    return this.adapters.get(id) ?? null
  }

  list(): ExportAdapter[] {
    return Array.from(this.adapters.values())
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }
}

/**
 * Create and return a fully loaded registry with all built-in adapters.
 * Sequencer formats (lemlist, apollo, woodpecker) are aliases that resolve
 * to the sequencer-csv adapter with the appropriate format option.
 */
export function createDefaultRegistry(): ExportRegistry {
  const registry = new ExportRegistry()
  registry.register(csvAdapter)
  registry.register(jsonAdapter)
  registry.register(googleSheetsAdapter)
  registry.register(webhookAdapter)
  registry.register(sequencerCsvAdapter)
  return registry
}
