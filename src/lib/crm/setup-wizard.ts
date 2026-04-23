/**
 * CRM Setup Wizard
 *
 * Interactive flow for connecting a CRM via its MCP server:
 *   1. Check MCP provider is installed and reachable
 *   2. Discover tools and objects
 *   3. Auto-map GTM-OS fields to CRM fields
 *   4. Show mapping for user confirmation
 *   5. Save to ~/.gtm-os/crm/<provider>.yaml
 *
 * Swapping CRM = running this wizard again with a different provider name.
 */

import { createInterface } from 'readline'
import type { McpProviderConfig } from '../providers/mcp-adapter'
import { validateMcpConfig, expandEnvVars } from '../providers/mcp-loader'
import { McpCrmAdapter } from './mcp-crm-adapter'
import { saveCrmConfig, loadCrmConfig } from './config-store'
import type {
  CRMProviderConfig,
  CRMObjectMapping,
  CRMObjectInfo,
} from './types'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ─── Readline helper ────────────────────────────────────────────────────────

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve))
}

// ─── Wizard ─────────────────────────────────────────────────────────────────

export interface SetupWizardOptions {
  provider: string
  nonInteractive?: boolean
  /** Override MCP config (for testing) */
  mcpConfig?: McpProviderConfig
}

export interface SetupWizardResult {
  success: boolean
  configPath?: string
  message: string
  config?: CRMProviderConfig
}

export async function runCrmSetupWizard(opts: SetupWizardOptions): Promise<SetupWizardResult> {
  const { provider, nonInteractive } = opts

  console.log(`\n── CRM Setup: ${provider} ──\n`)

  // Step 1: Load MCP config
  const mcpConfig = opts.mcpConfig ?? loadMcpConfig(provider)
  if (!mcpConfig) {
    return {
      success: false,
      message:
        `No MCP config found for "${provider}". ` +
        `Expected: ~/.gtm-os/mcp/${provider}.json or configs/mcp/${provider}.json\n` +
        `Available templates: hubspot, apollo, zoominfo, peopledatalabs`,
    }
  }

  console.log(`  MCP server: ${mcpConfig.displayName} (${mcpConfig.transport})`)

  // Step 2: Connect and discover
  console.log('  Connecting to MCP server...')
  const adapter = new McpCrmAdapter(mcpConfig)

  try {
    await adapter.connect()
  } catch (err) {
    return {
      success: false,
      message: `Failed to connect to ${provider} MCP server: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  console.log(`  Connected. Discovering objects...`)

  const tools = adapter.getDiscoveredTools()
  console.log(`  Found ${tools.length} tool(s)`)

  const objects = await adapter.discoverObjects()
  if (objects.length === 0) {
    await adapter.disconnect()
    return {
      success: false,
      message:
        `No CRM objects detected in ${provider} MCP tools. ` +
        `Tools found: ${tools.map(t => t.name).join(', ')}`,
    }
  }

  console.log(`  Detected objects: ${objects.map(o => o.displayName).join(', ')}\n`)

  // Step 3: Auto-map fields for each object
  const objectMappings: Record<string, CRMObjectMapping> = {}
  const rl = nonInteractive ? null : createInterface({ input: process.stdin, output: process.stdout })

  try {
    for (const obj of objects) {
      if (!obj.tools.list && !obj.tools.search) {
        console.log(`  Skipping ${obj.displayName} (no list/search tool)`)
        continue
      }
      if (!obj.tools.create) {
        console.log(`  Skipping ${obj.displayName} (no create tool)`)
        continue
      }

      console.log(`\n── ${obj.displayName} Field Mapping ──`)
      console.log(`  CRM fields: ${obj.fields.length}`)

      const mapResult = adapter.autoMapObject(obj)

      // Show confident mappings
      if (mapResult.confident.length > 0) {
        console.log(`\n  Auto-mapped (high confidence):`)
        for (const m of mapResult.confident) {
          console.log(`    ${m.gtm.padEnd(20)} -> ${m.crm}`)
        }
      }

      // Show uncertain mappings
      if (mapResult.uncertain.length > 0) {
        console.log(`\n  Uncertain (review recommended):`)
        for (const m of mapResult.uncertain) {
          console.log(`    ${m.gtm.padEnd(20)} -> ${m.crm} (score: ${m.score.toFixed(2)})`)
        }
      }

      // Show unmapped
      if (mapResult.unmapped.length > 0) {
        console.log(`\n  Unmapped GTM fields: ${mapResult.unmapped.join(', ')}`)
      }

      // Confirm mapping (interactive)
      if (rl && !nonInteractive) {
        const answer = await ask(rl, '\n  Accept mapping? (y/n/edit) [y]: ')
        if (answer.toLowerCase() === 'n') {
          console.log(`  Skipped ${obj.displayName}`)
          continue
        }
        // "edit" mode: let user override individual fields
        if (answer.toLowerCase() === 'edit') {
          await editMapping(rl, mapResult.mapping, obj)
        }
      }

      objectMappings[obj.name] = {
        listTool: obj.tools.list ?? obj.tools.search!,
        createTool: obj.tools.create,
        updateTool: obj.tools.update,
        searchTool: obj.tools.search,
        fieldMapping: mapResult.mapping,
      }
    }
  } finally {
    rl?.close()
  }

  await adapter.disconnect()

  if (Object.keys(objectMappings).length === 0) {
    return {
      success: false,
      message: 'No object mappings configured. Setup cancelled.',
    }
  }

  // Step 4: Build and save config
  const config: CRMProviderConfig = {
    provider,
    mcpServer: mcpConfig.name,
    objects: objectMappings,
    lastSetup: new Date().toISOString(),
    version: 1,
  }

  const configPath = saveCrmConfig(config)

  console.log(`\n  Config saved: ${configPath}`)
  console.log(`  Objects configured: ${Object.keys(objectMappings).join(', ')}`)
  console.log(`\n  You can edit the YAML file manually to adjust mappings.`)
  console.log(`  Run crm:verify --provider ${provider} to check for schema drift.\n`)

  return {
    success: true,
    configPath,
    message: `CRM setup complete for ${provider}`,
    config,
  }
}

// ─── Edit helper ────────────────────────────────────────────────────────────

async function editMapping(
  rl: ReturnType<typeof createInterface>,
  mapping: { gtmToCrm: Record<string, string>; crmToGtm: Record<string, string> },
  _object: CRMObjectInfo,
): Promise<void> {
  console.log('\n  Edit mode: enter "gtm_field=crm_field" to override, "done" to finish')

  while (true) {
    const input = await ask(rl, '  > ')
    if (input.toLowerCase() === 'done') break

    const parts = input.split('=')
    if (parts.length !== 2) {
      console.log('  Format: gtm_field=crm_field')
      continue
    }

    const [gtmField, crmField] = parts.map(s => s.trim())

    // Remove old reverse mapping
    const oldCrmField = mapping.gtmToCrm[gtmField]
    if (oldCrmField) delete mapping.crmToGtm[oldCrmField]

    mapping.gtmToCrm[gtmField] = crmField
    mapping.crmToGtm[crmField] = gtmField
    console.log(`  Updated: ${gtmField} -> ${crmField}`)
  }
}

// ─── MCP config loader ──────────────────────────────────────────────────────

function loadMcpConfig(provider: string): McpProviderConfig | null {
  // Check user config first, then shipped templates
  const paths = [
    join(homedir(), '.gtm-os', 'mcp', `${provider}.json`),
    join(process.cwd(), 'configs', 'mcp', `${provider}.json`),
  ]

  for (const filePath of paths) {
    if (!existsSync(filePath)) continue

    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
      const validation = validateMcpConfig(raw, `${provider}.json`)
      if (!validation.valid) {
        console.warn(`  Invalid MCP config at ${filePath}: ${validation.errors.join('; ')}`)
        continue
      }

      const { result: expanded } = expandEnvVars(raw)
      return expanded as McpProviderConfig
    } catch {
      continue
    }
  }

  return null
}
