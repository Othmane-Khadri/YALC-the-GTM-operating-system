import { readFileSync } from 'fs'
import { createInterface } from 'readline'
import { createReadStream } from 'fs'
import { db } from '../db'
import { resultSets, resultRows, workflows, conversations } from '../db/schema'
import { randomUUID } from 'crypto'
import { notionService } from '../services/notion'
import type { GTMOSConfig } from '../config/types'

interface ImportOptions {
  config: GTMOSConfig
  source: string
  input: string
  dryRun?: boolean
}

interface ImportResult {
  resultSetId: string
  rowCount: number
  source: string
}

export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const { source, input } = opts
  console.log(`[import] Importing leads from ${source}: ${input}`)

  let records: Record<string, unknown>[]

  switch (source) {
    case 'csv':
      records = await parseCsv(input)
      break
    case 'json':
      records = parseJson(input)
      break
    case 'notion':
      records = await importFromNotion(input)
      break
    case 'visitors':
      records = parseVisitors(input)
      break
    case 'engagers':
      records = parseEngagers(input)
      break
    case 'hubspot':
    case 'salesforce':
    case 'pipedrive':
    case 'crm':
      records = await importFromCrm(source === 'crm' ? input : source)
      break
    default:
      throw new Error(`Unknown source type: ${source}`)
  }

  console.log(`[import] Parsed ${records.length} records from ${source}`)

  if (records.length === 0) {
    throw new Error('No records found in input')
  }

  // Create a conversation and workflow to anchor the result set
  const conversationId = randomUUID()
  await db.insert(conversations).values({
    id: conversationId,
    title: `Import: ${source} — ${new Date().toISOString().slice(0, 10)}`,
  })

  const workflowId = randomUUID()
  await db.insert(workflows).values({
    id: workflowId,
    conversationId,
    title: `Import from ${source}`,
    description: `Imported ${records.length} leads from ${source}`,
    status: 'completed',
    stepsDefinition: JSON.stringify([]),
    resultCount: records.length,
  })

  // Create result set
  const resultSetId = randomUUID()
  const columns = Object.keys(records[0]).map(key => ({
    key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'text' as const,
  }))

  await db.insert(resultSets).values({
    id: resultSetId,
    workflowId,
    name: `${source} import — ${records.length} leads`,
    columnsDefinition: JSON.stringify(columns),
    rowCount: records.length,
  })

  // Insert rows
  for (let i = 0; i < records.length; i++) {
    await db.insert(resultRows).values({
      id: randomUUID(),
      resultSetId,
      rowIndex: i,
      data: JSON.stringify(records[i]),
    })
  }

  console.log(`[import] Created result set ${resultSetId} with ${records.length} rows`)
  return { resultSetId, rowCount: records.length, source }
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

async function parseCsv(filePath: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = []
  let headers: string[] = []

  const rl = createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  })

  let lineNum = 0
  for await (const line of rl) {
    if (lineNum === 0) {
      headers = parseCsvLine(line)
    } else {
      const values = parseCsvLine(line)
      const record: Record<string, unknown> = {}
      for (let i = 0; i < headers.length; i++) {
        record[headers[i]] = values[i] ?? ''
      }
      records.push(record)
    }
    lineNum++
  }

  return records
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        values.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }
  values.push(current.trim())
  return values
}

function parseJson(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function importFromNotion(databaseId: string): Promise<Record<string, unknown>[]> {
  const pages = await notionService.queryDatabase(databaseId)
  return pages.map(page => {
    const props = (page as { properties?: Record<string, unknown> }).properties ?? {}
    const record: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(props)) {
      const prop = value as Record<string, unknown>
      record[key] = extractNotionPropertyValue(prop)
    }

    return record
  })
}

function extractNotionPropertyValue(prop: Record<string, unknown>): unknown {
  const type = prop.type as string
  switch (type) {
    case 'title': {
      const arr = prop.title as { plain_text: string }[]
      return arr?.map(t => t.plain_text).join('') ?? ''
    }
    case 'rich_text': {
      const arr = prop.rich_text as { plain_text: string }[]
      return arr?.map(t => t.plain_text).join('') ?? ''
    }
    case 'number':
      return prop.number
    case 'select':
      return (prop.select as { name: string } | null)?.name ?? ''
    case 'multi_select': {
      const arr = prop.multi_select as { name: string }[]
      return arr?.map(s => s.name) ?? []
    }
    case 'url':
      return prop.url ?? ''
    case 'email':
      return prop.email ?? ''
    case 'phone_number':
      return prop.phone_number ?? ''
    case 'checkbox':
      return prop.checkbox
    case 'date':
      return (prop.date as { start: string } | null)?.start ?? ''
    default:
      return ''
  }
}

function parseVisitors(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  const visitors = Array.isArray(parsed) ? parsed : parsed.visitors ?? parsed.data ?? [parsed]

  return visitors.map((v: Record<string, unknown>) => ({
    first_name: v.first_name ?? v.firstName ?? '',
    last_name: v.last_name ?? v.lastName ?? '',
    headline: v.headline ?? v.title ?? '',
    company: v.company ?? v.company_name ?? '',
    linkedin_url: v.linkedin_url ?? v.profileUrl ?? v.profile_url ?? '',
    provider_id: v.provider_id ?? v.providerId ?? '',
    source: 'profile_visitor',
  }))
}

function parseEngagers(filePath: string): Record<string, unknown>[] {
  const raw = readFileSync(filePath, 'utf-8')
  const parsed = JSON.parse(raw)
  const engagers = Array.isArray(parsed) ? parsed : parsed.engagers ?? parsed.data ?? [parsed]

  return engagers.map((e: Record<string, unknown>) => ({
    first_name: e.first_name ?? e.firstName ?? '',
    last_name: e.last_name ?? e.lastName ?? '',
    headline: e.headline ?? e.title ?? '',
    company: e.company ?? e.company_name ?? '',
    linkedin_url: e.linkedin_url ?? e.profileUrl ?? e.profile_url ?? '',
    provider_id: e.provider_id ?? e.providerId ?? '',
    source: 'content_engager',
  }))
}

async function importFromCrm(provider: string): Promise<Record<string, unknown>[]> {
  const { loadCrmConfig } = await import('../crm/config-store')
  const { McpCrmAdapter } = await import('../crm/mcp-crm-adapter')
  const { existsSync, readFileSync: readFile } = await import('fs')
  const { join } = await import('path')
  const { homedir } = await import('os')
  const { validateMcpConfig, expandEnvVars } = await import('../providers/mcp-loader')

  // Load CRM config
  const crmConfig = loadCrmConfig(provider)
  if (!crmConfig) {
    throw new Error(
      `No CRM config for "${provider}". Run: npx tsx src/cli/index.ts crm:setup --provider ${provider}`,
    )
  }

  // Load MCP config
  const mcpPaths = [
    join(homedir(), '.gtm-os', 'mcp', `${crmConfig.mcpServer}.json`),
    join(process.cwd(), 'configs', 'mcp', `${crmConfig.mcpServer}.json`),
  ]

  let mcpConfig = null
  for (const p of mcpPaths) {
    if (existsSync(p)) {
      try {
        const raw = JSON.parse(readFile(p, 'utf-8'))
        const validation = validateMcpConfig(raw, `${crmConfig.mcpServer}.json`)
        if (validation.valid) {
          const { result } = expandEnvVars(raw)
          mcpConfig = result
          break
        }
      } catch {
        continue
      }
    }
  }

  if (!mcpConfig) {
    throw new Error(`MCP config not found for "${crmConfig.mcpServer}"`)
  }

  // Connect and import
  const adapter = new McpCrmAdapter(mcpConfig as any, crmConfig)
  const records: Record<string, unknown>[] = []

  try {
    await adapter.connect()
    for await (const batch of adapter.importContacts()) {
      records.push(...batch)
    }
  } finally {
    await adapter.disconnect()
  }

  // Tag source
  return records.map(r => ({ ...r, source: `crm:${provider}` }))
}
