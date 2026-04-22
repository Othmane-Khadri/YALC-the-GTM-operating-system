/**
 * CRM Adapter Interface
 *
 * Generic interface for any CRM system. Implementations can wrap
 * MCP servers, REST APIs, or direct database connections.
 * Field mappings live in YAML config, not in code.
 */

// ─── Field Mapping ──────────────────────────────────────────────────────────

export interface FieldMapping {
  /** GTM-OS field name -> CRM field name */
  gtmToCrm: Record<string, string>
  /** CRM field name -> GTM-OS field name (reverse) */
  crmToGtm: Record<string, string>
}

// ─── Filters ────────────────────────────────────────────────────────────────

export interface CRMFilter {
  field: string
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not_in'
  value: unknown
}

// ─── Sync ───────────────────────────────────────────────────────────────────

export interface SyncConfig {
  direction: 'push' | 'pull' | 'bidirectional'
  conflictResolution: 'crm_wins' | 'gtm_wins' | 'newest_wins'
  /** Fields to sync (empty = all mapped fields) */
  fields?: string[]
  /** Only sync records modified after this date */
  since?: string
}

export interface SyncResult {
  pushed: number
  pulled: number
  conflicts: number
  errors: Array<{ record: string; message: string }>
}

// ─── Push ───────────────────────────────────────────────────────────────────

export interface PushResult {
  created: number
  updated: number
  skipped: number
  errors: Array<{ record: string; message: string }>
}

// ─── CRM Object Metadata ───────────────────────────────────────────────────

export interface CRMObjectInfo {
  name: string
  displayName: string
  tools: {
    list?: string
    create?: string
    update?: string
    delete?: string
    search?: string
  }
  fields: CRMFieldInfo[]
}

export interface CRMFieldInfo {
  name: string
  type: string
  required: boolean
  description?: string
}

// ─── Schema Drift ───────────────────────────────────────────────────────────

export interface DriftReport {
  provider: string
  timestamp: string
  missingInCrm: string[]
  missingInMapping: string[]
  typeChanges: Array<{ field: string; expected: string; actual: string }>
  ok: boolean
}

// ─── Saved Config ───────────────────────────────────────────────────────────

export interface CRMProviderConfig {
  provider: string
  mcpServer: string
  objects: Record<string, CRMObjectMapping>
  lastSetup: string
  lastSync?: string
  version: number
}

export interface CRMObjectMapping {
  listTool: string
  createTool: string
  updateTool?: string
  searchTool?: string
  fieldMapping: FieldMapping
}

// ─── Core Adapter Interface ─────────────────────────────────────────────────

export interface CRMAdapter {
  /** Provider identifier (e.g., 'hubspot', 'salesforce', 'pipedrive') */
  provider: string

  /**
   * Import contacts from the CRM. Yields batches for streaming.
   * Filters are optional and use CRM field names (pre-mapping).
   */
  importContacts(filters?: CRMFilter[]): AsyncIterable<Record<string, unknown>[]>

  /**
   * Push leads to the CRM using the configured field mapping.
   * Creates new records or updates existing ones (upsert by email).
   */
  pushContacts(
    leads: Record<string, unknown>[],
    mapping: FieldMapping,
  ): Promise<PushResult>

  /**
   * Get suppression list: emails and domains already in CRM.
   * Used to avoid re-importing or double-contacting.
   */
  getSuppression(): Promise<Set<string>>

  /**
   * Optional bidirectional sync.
   */
  syncBidirectional?(config: SyncConfig): Promise<SyncResult>
}
