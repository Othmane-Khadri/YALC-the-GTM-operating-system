/**
 * MCP-CRM Adapter
 *
 * Wraps any CRM's MCP server as a generic CRMAdapter.
 * Reads tool definitions from the MCP server, auto-maps fields,
 * and translates CRMAdapter calls into MCP tool invocations.
 *
 * Swapping CRM = pointing this at a different MCP server config.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { McpProviderConfig, McpStdioConfig, McpSseConfig } from '../providers/mcp-adapter'
import type {
  CRMAdapter,
  CRMFilter,
  FieldMapping,
  PushResult,
  SyncConfig,
  SyncResult,
  CRMObjectInfo,
  CRMFieldInfo,
  DriftReport,
  CRMProviderConfig,
} from './types'
import { autoMapFields, applyMapping } from './field-mapper'

// ─── Tool name patterns for CRM object detection ────────────────────────────

const OBJECT_PATTERNS: Record<string, RegExp[]> = {
  contacts: [/contact/i, /person/i, /people/i, /lead/i],
  companies: [/company/i, /compani/i, /account/i, /organization/i, /org/i],
  deals: [/deal/i, /opportunity/i, /pipeline/i],
}

// Order matters: search checked before list so 'search_contacts' is not
// misclassified as a list tool.
const ACTION_PATTERNS: Array<[string, RegExp[]]> = [
  ['search', [/^search/i, /^find/i, /^query/i, /^lookup/i]],
  ['list', [/^list/i, /^get_all/i, /^fetch/i, /^get_/i]],
  ['create', [/^create/i, /^add/i, /^insert/i, /^new/i]],
  ['update', [/^update/i, /^edit/i, /^modify/i, /^patch/i]],
  ['delete', [/^delete/i, /^remove/i, /^destroy/i]],
]

// ─── Adapter ────────────────────────────────────────────────────────────────

export class McpCrmAdapter implements CRMAdapter {
  readonly provider: string
  private client: Client | null = null
  private connected = false
  private tools: Array<{ name: string; description?: string; inputSchema?: any }> = []
  private readonly mcpConfig: McpProviderConfig
  private savedConfig: CRMProviderConfig | null = null

  constructor(mcpConfig: McpProviderConfig, savedConfig?: CRMProviderConfig) {
    this.provider = mcpConfig.name
    this.mcpConfig = mcpConfig
    this.savedConfig = savedConfig ?? null
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    if (this.connected && this.client) return

    this.client = new Client({ name: 'gtm-os-crm', version: '1.0.0' })

    let transport: StdioClientTransport | SSEClientTransport

    if (this.mcpConfig.transport === 'stdio') {
      const cfg = this.mcpConfig as McpStdioConfig
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
      })
    } else {
      const cfg = this.mcpConfig as McpSseConfig
      transport = new SSEClientTransport(
        new URL(cfg.url),
        { requestInit: { headers: cfg.headers ?? {} } },
      )
    }

    await Promise.race([
      this.client.connect(transport),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('CRM MCP connection timeout')), 15_000),
      ),
    ])

    const result = await Promise.race([
      this.client.listTools(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('tools/list timeout')), 10_000),
      ),
    ])

    this.tools = (result as any).tools ?? []
    this.connected = true
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close()
      } catch {
        // ignore
      }
      this.client = null
    }
    this.connected = false
  }

  // ─── Discovery ────────────────────────────────────────────────────────────

  /**
   * Discover CRM objects from MCP tool definitions.
   * Groups tools by detected object type and action.
   */
  async discoverObjects(): Promise<CRMObjectInfo[]> {
    if (!this.connected) await this.connect()

    const objectMap = new Map<string, CRMObjectInfo>()

    for (const tool of this.tools) {
      const toolNameLower = tool.name.toLowerCase()
      const toolDesc = (tool.description ?? '').toLowerCase()
      const combined = `${toolNameLower} ${toolDesc}`

      // Detect which CRM object this tool relates to
      let objectName: string | null = null
      for (const [obj, patterns] of Object.entries(OBJECT_PATTERNS)) {
        if (patterns.some(p => p.test(combined))) {
          objectName = obj
          break
        }
      }
      if (!objectName) continue

      // Detect action type
      let actionType: string | null = null
      for (const [action, patterns] of ACTION_PATTERNS) {
        if (patterns.some(p => p.test(tool.name))) {
          actionType = action
          break
        }
      }
      if (!actionType) continue

      // Get or create object info
      if (!objectMap.has(objectName)) {
        objectMap.set(objectName, {
          name: objectName,
          displayName: objectName.charAt(0).toUpperCase() + objectName.slice(1),
          tools: {},
          fields: [],
        })
      }

      const obj = objectMap.get(objectName)!
      obj.tools[actionType as keyof CRMObjectInfo['tools']] = tool.name

      // Extract field info from tool input schema
      if (tool.inputSchema?.properties) {
        const props = tool.inputSchema.properties as Record<string, any>
        const required = new Set(tool.inputSchema.required ?? [])

        for (const [fieldName, fieldDef] of Object.entries(props)) {
          // Skip meta/pagination fields
          if (['limit', 'offset', 'page', 'cursor', 'after', 'before', 'sort'].includes(fieldName)) {
            continue
          }

          // Avoid duplicates
          if (!obj.fields.some(f => f.name === fieldName)) {
            obj.fields.push({
              name: fieldName,
              type: fieldDef.type ?? 'string',
              required: required.has(fieldName),
              description: fieldDef.description,
            })
          }
        }
      }
    }

    return Array.from(objectMap.values())
  }

  /**
   * Get all discovered tools (raw MCP tool list).
   */
  getDiscoveredTools(): Array<{ name: string; description?: string; inputSchema?: any }> {
    return [...this.tools]
  }

  /**
   * Auto-map fields for a specific CRM object.
   */
  autoMapObject(object: CRMObjectInfo) {
    return autoMapFields(object.fields)
  }

  // ─── CRMAdapter Interface ──────────────────────────────────────────────────

  async *importContacts(filters?: CRMFilter[]): AsyncIterable<Record<string, unknown>[]> {
    if (!this.connected) await this.connect()

    const objectConfig = this.getObjectConfig('contacts')
    const listTool = objectConfig.listTool

    // Build filter arguments
    const args: Record<string, unknown> = {}
    if (filters && filters.length > 0) {
      args.filters = filters.map(f => ({
        propertyName: objectConfig.fieldMapping.gtmToCrm[f.field] ?? f.field,
        operator: f.operator.toUpperCase(),
        value: f.value,
      }))
    }

    const result = await this.callTool(listTool, args)
    const rows = this.parseResult(result)

    // Apply reverse mapping (CRM -> GTM)
    const mapped = rows.map(row => applyMapping(row, objectConfig.fieldMapping.crmToGtm))

    // Yield in batches of 25
    const batchSize = 25
    for (let i = 0; i < mapped.length; i += batchSize) {
      yield mapped.slice(i, i + batchSize)
    }

    if (mapped.length === 0) {
      yield []
    }
  }

  async pushContacts(
    leads: Record<string, unknown>[],
    mapping: FieldMapping,
  ): Promise<PushResult> {
    if (!this.connected) await this.connect()

    const objectConfig = this.getObjectConfig('contacts')
    const createTool = objectConfig.createTool
    const effectiveMapping = mapping ?? objectConfig.fieldMapping

    const result: PushResult = {
      created: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    for (const lead of leads) {
      const crmRecord = applyMapping(lead, effectiveMapping.gtmToCrm)

      try {
        await this.callTool(createTool, crmRecord)
        result.created++
      } catch (err) {
        const email = (lead.email as string) ?? 'unknown'
        result.errors.push({
          record: email,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return result
  }

  async getSuppression(): Promise<Set<string>> {
    if (!this.connected) await this.connect()

    const suppression = new Set<string>()

    try {
      const objectConfig = this.getObjectConfig('contacts')
      const result = await this.callTool(objectConfig.listTool, {})
      const rows = this.parseResult(result)

      for (const row of rows) {
        // Look for email field in the CRM's native field names
        const emailField = objectConfig.fieldMapping.gtmToCrm['email'] ?? 'email'
        const email = row[emailField] as string | undefined
        if (email && typeof email === 'string' && email.includes('@')) {
          suppression.add(email.toLowerCase())
          const domain = email.split('@')[1]
          if (domain) suppression.add(domain.toLowerCase())
        }
      }
    } catch {
      // Non-fatal: return empty set if CRM is unreachable
    }

    return suppression
  }

  async syncBidirectional(config: SyncConfig): Promise<SyncResult> {
    const result: SyncResult = {
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      errors: [],
    }

    if (config.direction === 'pull' || config.direction === 'bidirectional') {
      let pulled = 0
      for await (const batch of this.importContacts()) {
        pulled += batch.length
      }
      result.pulled = pulled
    }

    // Push would require access to local lead store — handled at CLI layer
    return result
  }

  // ─── Drift Detection ──────────────────────────────────────────────────────

  async detectDrift(): Promise<DriftReport> {
    if (!this.connected) await this.connect()

    const report: DriftReport = {
      provider: this.provider,
      timestamp: new Date().toISOString(),
      missingInCrm: [],
      missingInMapping: [],
      typeChanges: [],
      ok: true,
    }

    if (!this.savedConfig) {
      return report
    }

    const currentObjects = await this.discoverObjects()

    for (const [objectName, objectMapping] of Object.entries(this.savedConfig.objects)) {
      const currentObject = currentObjects.find(o => o.name === objectName)
      if (!currentObject) {
        report.missingInCrm.push(`object:${objectName}`)
        report.ok = false
        continue
      }

      const currentFieldNames = new Set(currentObject.fields.map(f => f.name))
      const mappedCrmFields = Object.values(objectMapping.fieldMapping.gtmToCrm)

      // Check if mapped CRM fields still exist
      for (const crmField of mappedCrmFields) {
        if (!currentFieldNames.has(crmField)) {
          report.missingInCrm.push(crmField)
          report.ok = false
        }
      }

      // Check for new CRM fields not in mapping
      const mappedSet = new Set(mappedCrmFields)
      for (const field of currentObject.fields) {
        if (!mappedSet.has(field.name) && !['limit', 'offset', 'page', 'cursor'].includes(field.name)) {
          report.missingInMapping.push(field.name)
        }
      }

      // Check tools still exist
      const currentToolNames = new Set(this.tools.map(t => t.name))
      for (const toolName of [objectMapping.listTool, objectMapping.createTool, objectMapping.updateTool, objectMapping.searchTool]) {
        if (toolName && !currentToolNames.has(toolName)) {
          report.missingInCrm.push(`tool:${toolName}`)
          report.ok = false
        }
      }
    }

    // Non-mapped new fields are informational, not a failure
    if (report.missingInMapping.length > 0 && report.missingInCrm.length === 0 && report.typeChanges.length === 0) {
      report.ok = true
    }

    return report
  }

  // ─── Config Management ────────────────────────────────────────────────────

  setSavedConfig(config: CRMProviderConfig): void {
    this.savedConfig = config
  }

  getSavedConfig(): CRMProviderConfig | null {
    return this.savedConfig
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private getObjectConfig(objectName: string) {
    if (!this.savedConfig) {
      throw new Error(
        `No CRM config loaded for ${this.provider}. Run crm:setup first.`,
      )
    }

    const objectConfig = this.savedConfig.objects[objectName]
    if (!objectConfig) {
      throw new Error(
        `Object "${objectName}" not configured for ${this.provider}. ` +
        `Available: ${Object.keys(this.savedConfig.objects).join(', ')}`,
      )
    }

    return objectConfig
  }

  private async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error(`Not connected to ${this.provider} MCP server`)
    }

    return Promise.race([
      this.client.callTool({ name: toolName, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool call timeout: ${toolName}`)), 30_000),
      ),
    ])
  }

  private parseResult(result: unknown): Record<string, unknown>[] {
    if (!result || typeof result !== 'object') return []

    const res = result as Record<string, unknown>
    const content = res.content as Array<{ type: string; text?: string }> | undefined
    if (!content || !Array.isArray(content)) return []

    const rows: Record<string, unknown>[] = []

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text)
          if (Array.isArray(parsed)) {
            rows.push(...parsed.filter((r: unknown) => typeof r === 'object' && r !== null) as Record<string, unknown>[])
          } else if (typeof parsed === 'object' && parsed !== null) {
            const arrKey = Object.keys(parsed).find(k => Array.isArray((parsed as any)[k]))
            if (arrKey) {
              rows.push(...(parsed as any)[arrKey])
            } else {
              rows.push(parsed as Record<string, unknown>)
            }
          }
        } catch {
          rows.push({ text: item.text })
        }
      }
    }

    return rows
  }
}
