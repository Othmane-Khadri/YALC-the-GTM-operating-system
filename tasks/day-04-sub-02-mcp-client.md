# Sub-Brief 4.2 — MCP Client + MCPs Page

**Goal:** Install the MCP SDK. Build an MCP client that connects to user-configured MCP servers (stdio or SSE transport). Auto-discover tools on each server and register them as providers in the registry from 4.1. Build the `/mcps` management page.

**Depends on:** Sub-Brief 4.1 must be completed first. The provider registry and `StepExecutor` interface must exist.

---

## Read These Files First

1. `src/lib/providers/types.ts` — `StepExecutor` interface (from 4.1)
2. `src/lib/providers/registry.ts` — `ProviderRegistry`, `getRegistry()` (from 4.1)
3. `src/lib/db/schema.ts` — current tables, relations patterns, how `createdAt` defaults work
4. `src/lib/crypto.ts` — encryption utilities for sensitive data (env vars)
5. `src/components/layout/Sidebar.tsx` — MCPs nav item with `comingSoon: true`
6. `src/app/api-keys/page.tsx` — page layout pattern (JotaiProvider wrapper, sidebar, main content)
7. `src/components/api-keys/ApiKeysView.tsx` — card layout pattern to follow for consistency

---

## Install Dependency

```bash
pnpm add @modelcontextprotocol/sdk
```

Verify it resolves and `node_modules/@modelcontextprotocol/sdk` exists before proceeding.

---

## New Files to Create

### `src/lib/mcp/types.ts`

All MCP-related type definitions.

```ts
// McpServerConfig — persisted configuration for one MCP server
export interface McpServerConfig {
  id: string;           // UUID
  name: string;         // human-readable label
  transport: 'stdio' | 'sse';
  command?: string;     // stdio only: binary to run (e.g. "npx")
  args?: string[];      // stdio only: arguments (e.g. ["@modelcontextprotocol/server-filesystem", "/tmp"])
  url?: string;         // sse only: endpoint URL
  env?: Record<string, string>; // optional env vars passed to stdio process (stored encrypted)
}

// McpToolDefinition — one tool discovered from a connected server
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}

// McpConnection — runtime state of a connected server
export interface McpConnection {
  serverId: string;
  status: 'connected' | 'disconnected' | 'error';
  tools: McpToolDefinition[];
  connectedAt: string;    // ISO timestamp
  lastError?: string;
}
```

---

### `src/lib/mcp/client.ts`

The `McpConnectionManager` class. This is server-side only code (runs in API routes, not in browser).

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { McpServerConfig, McpConnection, McpToolDefinition } from './types';

class McpConnectionManager {
  private connections = new Map<string, { client: Client; connection: McpConnection }>();

  /**
   * Connect to an MCP server using its config.
   * Creates transport, initializes client, discovers tools.
   */
  async connect(config: McpServerConfig): Promise<McpConnection> {
    // Disconnect existing connection if any
    this.disconnect(config.id);

    let transport;
    if (config.transport === 'stdio') {
      transport = new StdioClientTransport({
        command: config.command!,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });
    } else {
      transport = new SSEClientTransport(new URL(config.url!));
    }

    const client = new Client(
      { name: 'gtm-os', version: '1.0.0' },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
      const tools = await this.discoverTools(config.id, client);

      const connection: McpConnection = {
        serverId: config.id,
        status: 'connected',
        tools,
        connectedAt: new Date().toISOString(),
      };

      this.connections.set(config.id, { client, connection });
      return connection;
    } catch (err) {
      const connection: McpConnection = {
        serverId: config.id,
        status: 'error',
        tools: [],
        connectedAt: new Date().toISOString(),
        lastError: err instanceof Error ? err.message : String(err),
      };
      return connection;
    }
  }

  disconnect(serverId: string): void {
    const entry = this.connections.get(serverId);
    if (entry) {
      entry.client.close().catch(() => {});
      this.connections.delete(serverId);
    }
  }

  private async discoverTools(serverId: string, client?: Client): Promise<McpToolDefinition[]> {
    const c = client ?? this.connections.get(serverId)?.client;
    if (!c) return [];

    const result = await c.listTools();
    return (result.tools ?? []).map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? {},
      serverId,
    }));
  }

  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const entry = this.connections.get(serverId);
    if (!entry) throw new Error(`Server ${serverId} not connected`);

    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  getConnections(): McpConnection[] {
    return Array.from(this.connections.values()).map(e => e.connection);
  }

  async healthCheck(serverId: string): Promise<{ ok: boolean }> {
    const entry = this.connections.get(serverId);
    if (!entry) return { ok: false };
    try {
      await entry.client.listTools();
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }
}

// Module-level singleton
export const mcpManager = new McpConnectionManager();
```

**Important notes on MCP SDK imports:**
- Check the actual export paths in `node_modules/@modelcontextprotocol/sdk`. The import paths above (`/client/index.js`, `/client/stdio.js`, `/client/sse.js`) are common but may differ by version. Adjust to match the installed version.
- `SSEClientTransport` may not exist in all versions. If it does not, use `StreamableHTTPClientTransport` or the appropriate transport class. Check the SDK exports.

---

### `src/lib/mcp/provider-bridge.ts`

Converts MCP tools into `StepExecutor` instances and registers/unregisters them in the provider registry.

```ts
import { StepExecutor, WorkflowStepInput, ExecutionContext, RowBatch, ProviderCapability } from '../providers/types';
import { getRegistry } from '../providers/registry';
import { mcpManager } from './client';
import { McpToolDefinition } from './types';

/**
 * Creates a StepExecutor for a single MCP tool.
 */
function createMcpExecutor(tool: McpToolDefinition): StepExecutor {
  const executorId = `mcp:${tool.serverId}:${tool.name}`;

  return {
    id: executorId,
    name: tool.name,
    description: tool.description,
    type: 'mcp',
    capabilities: inferCapabilities(tool),

    canExecute(step: WorkflowStepInput): boolean {
      return step.provider === executorId || step.provider === tool.name;
    },

    async *execute(step: WorkflowStepInput, context: ExecutionContext): AsyncIterable<RowBatch> {
      const result = await mcpManager.callTool(tool.serverId, tool.name, step.config);
      // Normalize result to rows
      const rows = normalizeToolResult(result);
      yield { rows, batchIndex: 0, totalSoFar: rows.length };
    },

    getColumnDefinitions(step: WorkflowStepInput) {
      // Derive columns from the tool's output schema if available.
      // Fall back to dynamic columns derived from actual result keys.
      return deriveColumnsFromSchema(tool.inputSchema);
    },

    async healthCheck() {
      const health = await mcpManager.healthCheck(tool.serverId);
      return { ok: health.ok, message: health.ok ? 'Connected' : 'Disconnected' };
    },
  };
}

/**
 * Infer provider capabilities from tool name/description heuristics.
 */
function inferCapabilities(tool: McpToolDefinition): ProviderCapability[] {
  const text = `${tool.name} ${tool.description}`.toLowerCase();
  const caps: ProviderCapability[] = [];
  if (text.includes('search') || text.includes('find') || text.includes('list')) caps.push('search');
  if (text.includes('enrich') || text.includes('lookup') || text.includes('detail')) caps.push('enrich');
  if (text.includes('filter') || text.includes('qualify') || text.includes('score')) caps.push('qualify');
  if (text.includes('export') || text.includes('write') || text.includes('save')) caps.push('export');
  if (caps.length === 0) caps.push('custom');
  return caps;
}

/**
 * Normalize arbitrary MCP tool results into row arrays.
 */
function normalizeToolResult(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result.map(r => (typeof r === 'object' && r !== null ? r : { value: r }) as Record<string, unknown>);
  if (typeof result === 'object' && result !== null) {
    // Check for common patterns: { content: [...] }, { results: [...] }, { data: [...] }
    const obj = result as Record<string, unknown>;
    for (const key of ['content', 'results', 'data', 'items', 'rows']) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
    return [obj];
  }
  return [{ value: result }];
}

/**
 * Derive ColumnDef[] from JSON Schema. Simplified — maps top-level properties.
 */
function deriveColumnsFromSchema(schema: Record<string, unknown>): import('../execution/columns').ColumnDef[] {
  // Import ColumnDef type from columns.ts
  // Create a column for each property in the schema's "properties" object
  const properties = (schema as any)?.properties ?? {};
  return Object.entries(properties).map(([key, _value]) => ({
    key,
    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'text' as const,
  }));
}

/**
 * Register all tools from a server as providers. Call after connect.
 */
export function registerMcpTools(tools: McpToolDefinition[]): void {
  const registry = getRegistry();
  for (const tool of tools) {
    const executor = createMcpExecutor(tool);
    registry.register(executor);
  }
}

/**
 * Unregister all tools from a server. Call before disconnect or remove.
 */
export function unregisterMcpTools(serverId: string): void {
  const registry = getRegistry();
  const allProviders = registry.getAll();
  for (const p of allProviders) {
    if (p.id.startsWith(`mcp:${serverId}:`)) {
      registry.unregister(p.id);
    }
  }
}
```

---

### `src/app/api/mcps/route.ts`

```
GET  /api/mcps       — list all configured MCP servers with connection status + tool count
POST /api/mcps       — add new server config, auto-connect, discover tools, register providers
```

Body for POST:
```json
{
  "name": "Filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {}
}
```

**Implementation notes:**
- Use Drizzle to read/write the `mcpServers` table.
- On POST: insert into DB -> call `mcpManager.connect(config)` -> call `registerMcpTools(connection.tools)` -> update DB row with status + tools JSON -> return server + connection data.
- On GET: read all rows from `mcpServers`, merge with `mcpManager.getConnections()` for live status.
- Encrypt `env` values before storing (use `src/lib/crypto.ts` pattern).

---

### `src/app/api/mcps/[id]/route.ts`

```
GET    /api/mcps/:id   — server details + full tool list
PATCH  /api/mcps/:id   — update config, reconnect
DELETE /api/mcps/:id   — disconnect, unregister providers, delete from DB
```

**Implementation notes:**
- DELETE must: call `unregisterMcpTools(id)` -> call `mcpManager.disconnect(id)` -> delete row from `mcpServers`.
- PATCH must: disconnect old -> update DB -> connect with new config -> register new tools.

---

### `src/app/api/mcps/[id]/connect/route.ts`

```
POST /api/mcps/:id/connect  — manually reconnect a disconnected server
```

Returns `{ status, tools }`.

Load config from DB, call `mcpManager.connect(config)`, register tools, update DB, return result.

---

### `src/app/mcps/page.tsx`

Follow the exact layout pattern from `src/app/api-keys/page.tsx`:

```tsx
import { JotaiProvider } from '@/components/providers/JotaiProvider'; // or whatever the provider wrapper is
import Sidebar from '@/components/layout/Sidebar';
import McpsView from '@/components/mcps/McpsView';

export default function McpsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="mcps" />
        <McpsView />
      </div>
    </JotaiProvider>
  );
}
```

Match whatever wrapper/layout pattern `api-keys/page.tsx` uses exactly.

---

### `src/components/mcps/McpsView.tsx`

Two sections stacked vertically:

1. **Connected Servers** — grid of `McpServerCard` components. If none, show empty state.
2. **Add Server** — the `AddServerForm` component.

**Empty state copy:**
> "MCP (Model Context Protocol) lets GTM-OS connect to external tools and data sources. Add an MCP server to unlock new providers for your workflows."

Fetch servers from `/api/mcps` on mount. Store in Jotai atom. Re-fetch after add/remove/reconnect.

---

### `src/components/mcps/McpServerCard.tsx`

Card for one MCP server. Follow the card styling from `ApiKeysView.tsx`.

**Contents:**
- Server name (bold)
- Transport badge: `stdio` or `sse` — use a small pill/badge
- Status dot: connected = `bg-matcha` (green), disconnected = `text-muted` (gray), error = `bg-pomegranate` (red)
- Tool count badge: e.g., "4 tools"
- Expandable section: list all discovered tools with name + description
- Actions row:
  - Reconnect button (outline) — calls `POST /api/mcps/:id/connect`
  - Edit button (outline) — opens inline edit form or modal (your choice, keep it simple)
  - Remove button (pomegranate text, requires confirm dialog) — calls `DELETE /api/mcps/:id`

Use the `cn()` utility for conditional classes. Use the `input-focus` class on any focusable elements.

---

### `src/components/mcps/AddServerForm.tsx`

Form to add a new MCP server.

**Fields:**
- **Name** — text input (required)
- **Transport** — toggle/segmented control: `stdio` | `sse`
- When `stdio`:
  - Command — text input (e.g., `npx`)
  - Args — tag-style input or comma-separated text (e.g., `@modelcontextprotocol/server-filesystem, /tmp`)
  - Env — key-value pair inputs (add/remove rows)
- When `sse`:
  - URL — text input (e.g., `http://localhost:3001/mcp`)

**Buttons:**
- "Test Connection" — calls POST with a flag or uses a separate test endpoint. On success: shows discovered tools in a preview list below the form.
- "Add Server" — submits to `POST /api/mcps`. On success: clears form, re-fetches server list.

Validation: name required, transport-specific fields required.

---

### `src/atoms/mcps.ts`

Jotai atoms for MCP state.

```ts
import { atom } from 'jotai';
import { McpServerConfig } from '@/lib/mcp/types';

export const mcpServersAtom = atom<(McpServerConfig & { status: string; toolCount: number })[]>([]);
export const mcpConnectionStatusAtom = atom<Record<string, 'connected' | 'disconnected' | 'error'>>({});
export const mcpLoadingAtom = atom<boolean>(false);
```

---

## Existing Files to Modify

### `src/lib/db/schema.ts`

Add the `mcpServers` table. Follow existing patterns in the file for table definition syntax (Drizzle SQLite).

```ts
export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),                          // UUID
  name: text('name').notNull(),
  transport: text('transport').notNull(),                // 'stdio' | 'sse'
  command: text('command'),                              // nullable, stdio only
  args: text('args'),                                    // JSON string, nullable
  url: text('url'),                                      // nullable, sse only
  env: text('env'),                                      // JSON string, encrypted, nullable
  status: text('status').default('disconnected'),        // 'connected' | 'disconnected' | 'error'
  lastConnectedAt: text('last_connected_at'),            // ISO timestamp, nullable
  discoveredTools: text('discovered_tools'),              // JSON string, nullable
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

// Relations (standalone, no FKs to other tables)
export const mcpServersRelations = relations(mcpServers, () => ({}));
```

After adding the table, you must run a migration or push:
```bash
pnpm drizzle-kit push
```
or whatever the project's migration command is (check `package.json` scripts).

---

### `src/components/layout/Sidebar.tsx`

Find the MCPs nav item and change `comingSoon: true` to `comingSoon: false` (or remove the `comingSoon` property entirely if that enables the link).

Before:
```ts
{ label: 'MCPs', href: '/mcps', icon: ..., comingSoon: true }
```

After:
```ts
{ label: 'MCPs', href: '/mcps', icon: ... }
```

---

## Verification Steps

Run these in order. Every one must pass.

1. **`pnpm install`** — MCP SDK installs without errors. Check `node_modules/@modelcontextprotocol/sdk` exists.
2. **`pnpm dev`** — app starts.
3. **Navigate to `/mcps`** — page renders with empty state message. Sidebar shows MCPs as active (not grayed out).
4. **Add test MCP server** — use the filesystem server for testing:
   - Name: "Filesystem"
   - Transport: stdio
   - Command: `npx`
   - Args: `@modelcontextprotocol/server-filesystem`, `/tmp`
   - Click "Test Connection" — should show discovered tools (e.g., `read_file`, `write_file`, `list_directory`)
   - Click "Add Server" — card appears in Connected Servers section
5. **Verify registry integration** — in the terminal or via a temporary console.log in `workflow-planner.ts`, confirm `registry.getAll()` includes MCP tools alongside the mock provider.
6. **Verify planner prompt** — the workflow planner's system prompt now lists the MCP tools dynamically.
7. **Remove server** — click Remove on the card, confirm. Card disappears. MCP tools removed from registry.
8. **`pnpm build`** — production build completes with zero errors.

---

## Commit Message

```
feat: MCP client + server management page (4.2)
```
