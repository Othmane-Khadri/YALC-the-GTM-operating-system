/**
 * MCP Provider Loader
 *
 * Scans ~/.gtm-os/mcp/*.json for MCP provider configs, validates them,
 * expands environment variables, and registers each as a provider in
 * the ProviderRegistry.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ProviderCapability } from './types'
import type { McpProviderConfig, McpStdioConfig, McpSseConfig } from './mcp-adapter'
import { McpProviderAdapter } from './mcp-adapter'
import type { ProviderRegistry } from './registry'

// ─── Constants ────────────────────────────────────────────────────────────────

const MCP_CONFIG_DIR = join(homedir(), '.gtm-os', 'mcp')
const VALID_CAPABILITIES: ProviderCapability[] = ['search', 'enrich', 'qualify', 'filter', 'export', 'custom']
const VALID_TRANSPORTS = ['stdio', 'sse'] as const

// ─── Config validation ────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateMcpConfig(raw: unknown, filename: string): ValidationResult {
  const errors: string[] = []

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: [`${filename}: not a valid JSON object`] }
  }

  const config = raw as Record<string, unknown>

  // Required fields
  if (!config.name || typeof config.name !== 'string') {
    errors.push(`${filename}: missing or invalid "name" (string required)`)
  }

  if (!config.displayName || typeof config.displayName !== 'string') {
    errors.push(`${filename}: missing or invalid "displayName" (string required)`)
  }

  if (!config.transport || !VALID_TRANSPORTS.includes(config.transport as any)) {
    errors.push(`${filename}: missing or invalid "transport" (must be "stdio" or "sse")`)
  }

  // Transport-specific fields
  if (config.transport === 'stdio') {
    if (!config.command || typeof config.command !== 'string') {
      errors.push(`${filename}: stdio transport requires "command" (string)`)
    }
    if (config.args !== undefined && !Array.isArray(config.args)) {
      errors.push(`${filename}: "args" must be an array of strings`)
    }
    if (config.env !== undefined && (typeof config.env !== 'object' || config.env === null)) {
      errors.push(`${filename}: "env" must be an object`)
    }
  } else if (config.transport === 'sse') {
    if (!config.url || typeof config.url !== 'string') {
      errors.push(`${filename}: sse transport requires "url" (string)`)
    }
    if (config.headers !== undefined && (typeof config.headers !== 'object' || config.headers === null)) {
      errors.push(`${filename}: "headers" must be an object`)
    }
  }

  // Capabilities
  if (!Array.isArray(config.capabilities) || config.capabilities.length === 0) {
    errors.push(`${filename}: "capabilities" must be a non-empty array`)
  } else {
    for (const cap of config.capabilities as unknown[]) {
      if (!VALID_CAPABILITIES.includes(cap as ProviderCapability)) {
        errors.push(`${filename}: invalid capability "${cap}". Valid: ${VALID_CAPABILITIES.join(', ')}`)
      }
    }
  }

  // Health check (optional)
  if (config.healthCheck !== undefined) {
    if (typeof config.healthCheck !== 'object' || config.healthCheck === null) {
      errors.push(`${filename}: "healthCheck" must be an object with "tool" and "timeout"`)
    } else {
      const hc = config.healthCheck as Record<string, unknown>
      if (!hc.tool || typeof hc.tool !== 'string') {
        errors.push(`${filename}: healthCheck.tool must be a string`)
      }
      if (hc.timeout !== undefined && typeof hc.timeout !== 'number') {
        errors.push(`${filename}: healthCheck.timeout must be a number`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Environment variable expansion ──────────────────────────────────────────

/**
 * Recursively expand ${ENV_VAR} references in config values.
 * Returns a list of missing variables so the caller can decide what to do.
 */
export function expandEnvVars(
  obj: unknown,
  missing: string[] = [],
): { result: unknown; missing: string[] } {
  if (typeof obj === 'string') {
    const expanded = obj.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      const val = process.env[varName]
      if (val === undefined) {
        missing.push(varName)
        return `\${${varName}}`
      }
      return val
    })
    return { result: expanded, missing }
  }

  if (Array.isArray(obj)) {
    const arr = obj.map(item => expandEnvVars(item, missing).result)
    return { result: arr, missing }
  }

  if (obj && typeof obj === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      out[key] = expandEnvVars(val, missing).result
    }
    return { result: out, missing }
  }

  return { result: obj, missing }
}

// ─── Loader ───────────────────────────────────────────────────────────────────

export interface McpLoadResult {
  total: number
  available: number
  unavailable: string[]
  errors: Array<{ file: string; messages: string[] }>
  adapters: McpProviderAdapter[]
}

/**
 * Scan ~/.gtm-os/mcp/ for JSON configs, validate, expand env vars,
 * connect, and register in the provided registry.
 */
export async function loadMcpProviders(registry: ProviderRegistry): Promise<McpLoadResult> {
  const result: McpLoadResult = {
    total: 0,
    available: 0,
    unavailable: [],
    errors: [],
    adapters: [],
  }

  // Ensure directory exists
  if (!existsSync(MCP_CONFIG_DIR)) {
    mkdirSync(MCP_CONFIG_DIR, { recursive: true })
    return result
  }

  // Scan for JSON files
  const files = readdirSync(MCP_CONFIG_DIR).filter(f => f.endsWith('.json'))
  if (files.length === 0) return result

  for (const file of files) {
    const filePath = join(MCP_CONFIG_DIR, file)

    // Parse JSON
    let raw: unknown
    try {
      const content = readFileSync(filePath, 'utf-8')
      raw = JSON.parse(content)
    } catch (err) {
      result.errors.push({
        file,
        messages: [`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
      })
      continue
    }

    // Validate schema
    const validation = validateMcpConfig(raw, file)
    if (!validation.valid) {
      result.errors.push({ file, messages: validation.errors })
      continue
    }

    // Expand env vars
    const missingVars: string[] = []
    const { result: expanded } = expandEnvVars(raw, missingVars)
    const config = expanded as McpProviderConfig

    result.total++

    // If critical env vars are missing, mark unavailable
    if (missingVars.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mcp-loader] ${config.name}: missing env vars: ${missingVars.join(', ')} — marked unavailable`,
      )
      // Still register so it shows up in provider:list, but won't connect
      const adapter = new McpProviderAdapter(config)
      registry.register(adapter)
      result.adapters.push(adapter)
      result.unavailable.push(config.name)
      continue
    }

    // Create adapter and attempt connection
    const adapter = new McpProviderAdapter(config)
    await adapter.connect()

    registry.register(adapter)
    result.adapters.push(adapter)

    if (adapter.isAvailable()) {
      result.available++
    } else {
      result.unavailable.push(config.name)
    }
  }

  // Log summary
  if (result.total > 0) {
    const unavailStr =
      result.unavailable.length > 0 ? `, ${result.unavailable.length} unavailable: ${result.unavailable.join(', ')}` : ''
    // eslint-disable-next-line no-console
    console.log(
      `[mcp-loader] Loaded ${result.total} MCP provider(s) (${result.available} available${unavailStr})`,
    )
  }

  // Log validation errors
  for (const err of result.errors) {
    // eslint-disable-next-line no-console
    console.warn(`[mcp-loader] Skipped ${err.file}: ${err.messages.join('; ')}`)
  }

  return result
}

/**
 * Get the MCP config directory path.
 */
export function getMcpConfigDir(): string {
  return MCP_CONFIG_DIR
}

/**
 * List available template config names from the shipped configs/mcp/ directory.
 */
export function listTemplateConfigs(): string[] {
  const templateDir = join(process.cwd(), 'configs', 'mcp')
  if (!existsSync(templateDir)) return []
  return readdirSync(templateDir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
}
