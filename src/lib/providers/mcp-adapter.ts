/**
 * MCP Provider Adapter
 *
 * Wraps any MCP server as a StepExecutor, enabling drop-in
 * registration in the ProviderRegistry alongside builtin providers.
 *
 * Supports stdio and SSE transports. Discovers tools via tools/list,
 * maps them to GTM-OS capabilities, and executes tool calls when the
 * provider is used in a pipeline step.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type {
  StepExecutor,
  RowBatch,
  ExecutionContext,
  WorkflowStepInput,
  ProviderCapability,
} from './types'
import type { ColumnDef } from '../ai/types'

// ─── Debug + secret-masking helpers ──────────────────────────────────────────

/**
 * True when the user opted into transport-level debug output via
 * `--verbose` (which sets GTM_OS_VERBOSE=1) or YALC_DEBUG=1. Default-off
 * suppresses chatter from `mcp-remote` and similar stdio servers — that
 * chatter routinely contains Authorization bearer tokens.
 */
function isMcpDebugEnabled(): boolean {
  return process.env.YALC_DEBUG === '1' || process.env.GTM_OS_VERBOSE === '1'
}

/**
 * Mask anything that looks like a credential before it lands in console
 * output. The list is intentionally over-broad — better to mask a harmless
 * string than to leak a real key.
 */
export function maskSecrets(input: string): string {
  if (!input) return input
  let out = input
  // Authorization: Bearer <token>
  out = out.replace(/(Authorization\s*[:=]\s*Bearer\s+)\S+/gi, '$1***')
  // x-api-key: <token>, api-key: <token>
  out = out.replace(/(x-api-key\s*[:=]\s*)\S+/gi, '$1***')
  out = out.replace(/(api[-_]?key\s*[:=]\s*)["']?[^"'\s,}]+/gi, '$1***')
  // cookie / set-cookie headers (whole value)
  out = out.replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, '$1***')
  // JSON-style "apiKey": "...", "api_key": "...", "token": "...", "access_token": "..."
  out = out.replace(/("(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|password)"\s*:\s*)"[^"]*"/gi, '$1"***"')
  // Bearer <token> anywhere (covers JSON bodies that rebuild headers as strings)
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-+/=]{8,}/g, '$1***')
  // sk-... style tokens (Anthropic, OpenAI, etc.) appearing bare
  out = out.replace(/\bsk-[A-Za-z0-9._\-]{8,}/g, 'sk-***')
  return out
}

/**
 * Single chokepoint for MCP-related console output. Suppressed by default;
 * always passes through `maskSecrets` so even when verbose is on the
 * captured chatter never reveals a live bearer token.
 */
export function logMcp(level: 'log' | 'warn' | 'error', ...parts: unknown[]): void {
  if (!isMcpDebugEnabled() && level === 'log') return
  const masked = parts.map(p =>
    typeof p === 'string' ? maskSecrets(p) : p,
  )
  // eslint-disable-next-line no-console
  console[level](...masked)
}

// ─── Config types ─────────────────────────────────────────────────────────────

export interface McpHealthCheck {
  tool: string
  timeout: number
}

export interface McpProviderConfigBase {
  name: string
  displayName: string
  capabilities: ProviderCapability[]
  healthCheck?: McpHealthCheck
}

export interface McpStdioConfig extends McpProviderConfigBase {
  transport: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpSseConfig extends McpProviderConfigBase {
  transport: 'sse'
  url: string
  headers?: Record<string, string>
}

export type McpProviderConfig = McpStdioConfig | McpSseConfig

// ─── Error classifier ─────────────────────────────────────────────────────────

export type McpErrorKind =
  | 'package_not_found'
  | 'auth_failed'
  | 'network_unreachable'
  | 'timeout'
  | 'tool_missing'
  | 'unknown'

export interface ClassifiedMcpError {
  kind: McpErrorKind
  message: string
  hint: string
}

/**
 * Map raw error text from `npm` / MCP transports / health checks into a
 * stable shape with a user-actionable hint.
 *
 * The matchers are intentionally loose — npm registry errors, transport
 * `ECONNREFUSED`, and SDK-level timeouts all surface as plain Error.message
 * strings, so we pattern-match the common signatures first and fall back
 * to 'unknown' so the raw text still reaches the user.
 */
export function classifyMcpError(err: unknown, childStderr?: string): ClassifiedMcpError {
  const sdkMsg = err instanceof Error ? err.message : String(err)
  // Combine the SDK message with the spawned child's stderr so signals
  // like `npm error code E404` (which the SDK never sees) reach us.
  const haystack = childStderr ? `${sdkMsg}\n${childStderr}` : sdkMsg

  if (/E404|404 Not Found|not found in registry|npm error 404|npm error code E404/i.test(haystack)) {
    // Surface the offending package name when we can extract it from npm chatter.
    const pkgMatch = haystack.match(/(?:404\s+Not\s+Found[^\n]*?:\s*|GET\s+https?:\/\/[^\s]+\/)(@?[\w./-]+)/i)
    const pkgHint = pkgMatch ? ` Package: ${pkgMatch[1]}` : ''
    return {
      kind: 'package_not_found',
      message: 'MCP package not found on npm',
      hint: `Verify "command"/"args" in your config. If using a private package, ensure your npm auth is set.${pkgHint}`,
    }
  }
  if (/Cannot find module|MODULE_NOT_FOUND|command not found:/i.test(haystack)) {
    return {
      kind: 'package_not_found',
      message: 'MCP command/module not found on this machine',
      hint: 'The configured `command` is not installed. Install it (e.g. `npm i -g <pkg>`) or fix the path in your config.',
    }
  }
  if (/401|403|unauthorized|forbidden|invalid.*token|expired|ENEEDAUTH|npm error code ENEEDAUTH/i.test(haystack)) {
    return {
      kind: 'auth_failed',
      message: 'MCP server rejected authentication',
      hint: 'Check the API key/token referenced in your config\'s "env" block.',
    }
  }
  if (/ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(haystack)) {
    return {
      kind: 'network_unreachable',
      message: 'MCP server is unreachable',
      hint: 'Check the endpoint URL and your network. If using a local MCP, confirm it\'s running.',
    }
  }
  if (/ETIMEDOUT|timeout|timed out/i.test(haystack)) {
    return {
      kind: 'timeout',
      message: 'MCP health check timed out',
      hint: 'The server didn\'t respond in time. Increase healthCheck.timeout in the config or check for server load.',
    }
  }
  if (/tool .* not found|no matching tool/i.test(haystack)) {
    return {
      kind: 'tool_missing',
      message: 'MCP server is up but the requested tool is not exposed',
      hint: 'Run provider:test to list discovered tools, then update step.config.tool to one of them.',
    }
  }
  return { kind: 'unknown', message: sdkMsg, hint: '' }
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export class McpProviderAdapter implements StepExecutor {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly type = 'mcp' as const
  readonly capabilities: ProviderCapability[]

  private client: Client | null = null
  private available = false
  private tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = []
  private readonly config: McpProviderConfig
  private lastConnectError: ClassifiedMcpError | null = null
  /**
   * Ring buffer of the last ~50 stderr lines from the spawned MCP child.
   * Used both by the MCP error classifier (so npm `E404`/`ENEEDAUTH`
   * messages reach the user) and by `--verbose` debug output. Always
   * masked before being surfaced.
   */
  private childStderrBuffer: string[] = []
  private static readonly STDERR_BUFFER_LINES = 50

  private appendChildStderr(chunk: string): void {
    if (!chunk) return
    const masked = maskSecrets(chunk)
    for (const line of masked.split(/\r?\n/)) {
      if (!line) continue
      this.childStderrBuffer.push(line)
      if (this.childStderrBuffer.length > McpProviderAdapter.STDERR_BUFFER_LINES) {
        this.childStderrBuffer.shift()
      }
      // In verbose mode, surface the (already-masked) line live.
      if (isMcpDebugEnabled()) {
        // eslint-disable-next-line no-console
        console.error(`[mcp:${this.config.name}] ${line}`)
      }
    }
  }

  /**
   * Snapshot the captured (masked) child stderr — primarily used for
   * error classification. Newest line last.
   */
  getChildStderrSnapshot(): string {
    return this.childStderrBuffer.join('\n')
  }

  constructor(config: McpProviderConfig) {
    this.config = config
    this.id = `mcp:${config.name}`
    this.name = config.displayName
    this.description = `MCP provider: ${config.displayName} (${config.capabilities.join(', ')})`
    this.capabilities = [...config.capabilities]
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Connect to the MCP server, discover tools, and mark availability.
   * Never throws — marks unavailable on failure.
   */
  async connect(): Promise<void> {
    try {
      this.client = new Client({ name: 'gtm-os', version: '1.0.0' })

      let transport: StdioClientTransport | SSEClientTransport

      if (this.config.transport === 'stdio') {
        const cfg = this.config as McpStdioConfig
        const stdioTransport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args ?? [],
          env: { ...process.env, ...(cfg.env ?? {}) } as Record<string, string>,
          // Pipe stderr so we can capture npm/server chatter without
          // letting it land on the user's TTY. The SDK's `stderr` getter
          // wires up immediately on construction.
          stderr: 'pipe',
        })
        const childErr = stdioTransport.stderr
        if (childErr) {
          childErr.on('data', (buf: Buffer | string) => {
            this.appendChildStderr(typeof buf === 'string' ? buf : buf.toString('utf-8'))
          })
        }
        transport = stdioTransport
      } else {
        const cfg = this.config as McpSseConfig
        transport = new SSEClientTransport(
          new URL(cfg.url),
          { requestInit: { headers: cfg.headers ?? {} } },
        )
      }

      // Connect with a timeout to avoid hanging
      await Promise.race([
        this.client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), 10_000),
        ),
      ])

      // Discover tools
      const result = await Promise.race([
        this.client.listTools(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('tools/list timeout')), 10_000),
        ),
      ])

      this.tools = (result as any).tools ?? []
      this.available = true
      this.lastConnectError = null
    } catch (err) {
      // Hand both the SDK error AND the captured (masked) child stderr to
      // the classifier so npm `E404` / `ENEEDAUTH` style failures don't
      // collapse to `unknown`.
      this.lastConnectError = classifyMcpError(err, this.getChildStderrSnapshot())
      logMcp(
        'warn',
        `[mcp:${this.config.name}] Connection failed (${this.lastConnectError.kind}): ${this.lastConnectError.message}`,
      )
      this.available = false
      this.client = null
    }
  }

  /**
   * Surface the most recent classified connect failure (if any). Callers
   * can use this to render a stable error block instead of the raw text.
   */
  getLastConnectError(): ClassifiedMcpError | null {
    return this.lastConnectError
  }

  /**
   * Disconnect gracefully.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close()
      } catch {
        // ignore
      }
      this.client = null
    }
    this.available = false
  }

  // ─── StepExecutor interface ──────────────────────────────────────────────

  isAvailable(): boolean {
    return this.available
  }

  canExecute(step: WorkflowStepInput): boolean {
    // Match by provider name (exact or with mcp: prefix)
    if (step.provider === this.id || step.provider === this.config.name) return true
    if (step.provider === `mcp:${this.config.name}`) return true

    // Capability-based match
    const cap = step.stepType as ProviderCapability
    return this.capabilities.includes(cap)
  }

  async *execute(
    step: WorkflowStepInput,
    context: ExecutionContext,
  ): AsyncIterable<RowBatch> {
    if (!this.client || !this.available) {
      // Attempt reconnect
      await this.connect()
      if (!this.client || !this.available) {
        throw new Error(`[mcp:${this.config.name}] Provider unavailable — cannot execute`)
      }
    }

    // Determine which MCP tool to call.
    // Priority: step.config.tool > first tool matching step description > first tool
    const toolName = this.resolveToolName(step)
    if (!toolName) {
      throw new Error(
        `[mcp:${this.config.name}] No matching tool found for step "${step.title}". Available: ${this.tools.map(t => t.name).join(', ')}`,
      )
    }

    // Build arguments from step config + previous step rows.
    // `step.config` is, by construction, only tool args (skill-runtime
    // fields live on `step.metadata`). We still strip `tool` (our routing
    // key) and any `_yalc_*` keys as a defence-in-depth — third-party
    // adapters or older callers may still smuggle internal fields here.
    const args: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(step.config ?? {})) {
      if (k === 'tool') continue
      if (k.startsWith('_yalc_')) continue
      args[k] = v
    }

    // If there are previous step rows, pass them as input
    if (context.previousStepRows && context.previousStepRows.length > 0) {
      args.input_rows = context.previousStepRows
    }

    try {
      const result = await Promise.race([
        this.client.callTool({ name: toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Tool call timeout (${toolName})`)),
            this.config.healthCheck?.timeout ?? 30_000,
          ),
        ),
      ])

      // Parse MCP result into rows
      const rows = this.parseToolResult(result)

      // Yield in batches
      const batchSize = context.batchSize || 25
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize)
        yield {
          rows: batch,
          batchIndex: Math.floor(i / batchSize),
          totalSoFar: Math.min(i + batchSize, rows.length),
        }
      }

      // If no rows extracted, yield empty batch
      if (rows.length === 0) {
        yield { rows: [], batchIndex: 0, totalSoFar: 0 }
      }
    } catch (err) {
      // On connection drops, mark unavailable
      if (
        err instanceof Error &&
        (err.message.includes('timeout') ||
          err.message.includes('ECONNREFUSED') ||
          err.message.includes('closed'))
      ) {
        this.available = false
      }
      throw err
    }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    // MCP providers return dynamic schemas — return a generic set
    return [
      { key: 'id', label: 'ID', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'data', label: 'Data', type: 'text' },
    ]
  }

  async healthCheck(): Promise<{ ok: boolean; message: string; classified?: ClassifiedMcpError }> {
    // Reuse a prior connect failure instead of running connect() a second
    // time — this dedupes the npm error spam users were seeing.
    if (!this.client || !this.available) {
      if (this.lastConnectError) {
        return { ok: false, message: this.lastConnectError.message, classified: this.lastConnectError }
      }
      await this.connect()
      if (!this.client || !this.available) {
        const classified = this.lastConnectError ?? classifyMcpError('Cannot connect to MCP server')
        return { ok: false, message: classified.message, classified }
      }
    }

    if (!this.config.healthCheck) {
      return { ok: this.available, message: this.available ? 'Connected' : 'Unavailable' }
    }

    const { tool, timeout } = this.config.healthCheck

    // Check if the tool exists in discovered tools
    const toolExists = this.tools.some(t => t.name === tool)
    if (!toolExists) {
      const classified: ClassifiedMcpError = {
        kind: 'tool_missing',
        message: `Health check tool "${tool}" not found`,
        hint: `Available tools: ${this.tools.map(t => t.name).join(', ') || '(none discovered)'}`,
      }
      return { ok: false, message: classified.message, classified }
    }

    try {
      await Promise.race([
        this.client.callTool({ name: tool, arguments: {} }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), timeout),
        ),
      ])
      return { ok: true, message: `Tool "${tool}" responded` }
    } catch (err) {
      const classified = classifyMcpError(err)
      return { ok: false, message: classified.message, classified }
    }
  }

  // ─── Tool info ────────────────────────────────────────────────────────────

  getDiscoveredTools(): Array<{ name: string; description?: string }> {
    return this.tools.map(t => ({ name: t.name, description: t.description }))
  }

  getConfig(): McpProviderConfig {
    return this.config
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private resolveToolName(step: WorkflowStepInput): string | null {
    // Explicit tool in config
    if (step.config?.tool && typeof step.config.tool === 'string') {
      const match = this.tools.find(t => t.name === step.config!.tool)
      if (match) return match.name
    }

    // Match by step description keywords
    const desc = (step.description ?? '').toLowerCase()
    for (const t of this.tools) {
      const toolDesc = (t.description ?? t.name).toLowerCase()
      if (desc.includes(t.name.toLowerCase())) return t.name
      // Check for keyword overlap
      const descWords = desc.split(/\s+/)
      const toolWords = toolDesc.split(/\s+/)
      const overlap = descWords.filter(w => w.length > 3 && toolWords.includes(w))
      if (overlap.length >= 2) return t.name
    }

    // Fall back to first tool
    return this.tools[0]?.name ?? null
  }

  private parseToolResult(result: unknown): Record<string, unknown>[] {
    if (!result || typeof result !== 'object') return []

    const res = result as Record<string, unknown>

    // MCP tools return content array with text items
    const content = res.content as Array<{ type: string; text?: string }> | undefined
    if (!content || !Array.isArray(content)) return []

    const rows: Record<string, unknown>[] = []

    for (const item of content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text)
          if (Array.isArray(parsed)) {
            rows.push(...parsed.map((r: unknown) => (typeof r === 'object' && r !== null ? r : { data: r }) as Record<string, unknown>))
          } else if (typeof parsed === 'object' && parsed !== null) {
            // Single object — check for nested arrays
            const arrKey = Object.keys(parsed).find(k => Array.isArray((parsed as any)[k]))
            if (arrKey) {
              rows.push(...(parsed as any)[arrKey])
            } else {
              rows.push(parsed as Record<string, unknown>)
            }
          }
        } catch {
          // Not JSON — wrap as text row
          rows.push({ text: item.text })
        }
      }
    }

    return rows
  }
}
