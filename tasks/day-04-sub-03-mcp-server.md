# Sub-Brief 4.3 — GTM-OS as MCP Server

**Goal:** Expose GTM-OS capabilities as an MCP server so external AI agents (Claude Desktop, other MCP clients, custom automations) can call GTM-OS functions. This makes GTM-OS a composable building block in any agentic workflow.

**Depends on:** Sub-Briefs 4.1 and 4.2 must be completed first. The provider registry and MCP SDK must be in place.

---

## Read These Files First

1. `src/lib/mcp/client.ts` — MCP client pattern from 4.2 (understand the SDK usage)
2. `src/lib/mcp/types.ts` — MCP types from 4.2
3. `src/lib/providers/registry.ts` — provider registry from 4.1 (`getAll()`)
4. `src/lib/providers/types.ts` — `ProviderMetadata` type
5. `src/lib/framework/types.ts` — `GTMFramework` type, `Learning` type
6. `src/lib/framework/context.ts` — `buildFrameworkContext()` function
7. `src/lib/execution/learning-extractor.ts` — learning system (how learnings are stored/queried)
8. `src/lib/db/schema.ts` — DB tables (frameworks, knowledgeItems, resultSets, resultRows)
9. `src/components/mcps/McpsView.tsx` — current MCPs page (from 4.2, will add a section)
10. `node_modules/@modelcontextprotocol/sdk` — check available server-side exports, especially `Server` class and `StdioServerTransport`/`SSEServerTransport`

---

## New Files to Create

### `src/lib/mcp/server.ts`

Creates the MCP Server instance and registers the 5 tools.

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// Import the appropriate transport for SSE-based server (check SDK exports)

import {
  handleSearchLeads,
  handleGetFramework,
  handleGetLearnings,
  handleQualifyLead,
  handleGetAvailableProviders,
} from './server-tools';

export function createGtmOsServer(): Server {
  const server = new Server(
    { name: 'gtm-os', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register tools
  server.setRequestHandler(/* ListToolsRequestSchema */, async () => {
    return {
      tools: [
        {
          name: 'search_leads',
          description: 'Search for leads/companies matching a query using GTM-OS providers. Returns structured lead data.',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query describing the target companies/leads' },
              count: { type: 'number', description: 'Number of results to return (default: 10)' },
              filters: {
                type: 'object',
                description: 'Optional filters: industry, employeeRange, location, stage',
                properties: {
                  industry: { type: 'string' },
                  employeeRange: { type: 'string' },
                  location: { type: 'string' },
                  stage: { type: 'string' },
                },
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_framework',
          description: 'Get the user\'s GTM framework configuration (ICP, messaging, segments, signals).',
          inputSchema: {
            type: 'object',
            properties: {
              sections: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional: specific framework sections to return (e.g., ["icp", "messaging", "signals"]). Omit for full framework.',
              },
            },
          },
        },
        {
          name: 'get_learnings',
          description: 'Retrieve accumulated GTM learnings and intelligence from past campaigns.',
          inputSchema: {
            type: 'object',
            properties: {
              confidence: { type: 'string', description: 'Filter by confidence level: high, medium, low' },
              segment: { type: 'string', description: 'Filter by ICP segment name' },
            },
          },
        },
        {
          name: 'qualify_lead',
          description: 'Score and qualify a lead against the user\'s ICP framework and accumulated learnings.',
          inputSchema: {
            type: 'object',
            properties: {
              lead: {
                type: 'object',
                description: 'Lead data object with company/person fields',
              },
              segment: { type: 'string', description: 'Optional: specific ICP segment to qualify against' },
            },
            required: ['lead'],
          },
        },
        {
          name: 'get_available_providers',
          description: 'List all data providers currently available in GTM-OS (built-in, MCP, mock).',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };
  });

  server.setRequestHandler(/* CallToolRequestSchema */, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'search_leads':
        return handleSearchLeads(args as any);
      case 'get_framework':
        return handleGetFramework(args as any);
      case 'get_learnings':
        return handleGetLearnings(args as any);
      case 'qualify_lead':
        return handleQualifyLead(args as any);
      case 'get_available_providers':
        return handleGetAvailableProviders();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });

  return server;
}
```

**Important SDK notes:**
- Import `ListToolsRequestSchema` and `CallToolRequestSchema` from the SDK. Check actual export paths — they may be at `@modelcontextprotocol/sdk/types.js` or similar.
- The `setRequestHandler` call signature may differ by SDK version. Read the SDK source to confirm.
- Tool responses must follow MCP format: `{ content: [{ type: 'text', text: JSON.stringify(result) }] }`.

---

### `src/lib/mcp/server-tools.ts`

Handler functions for each server tool. These are the actual business logic.

```ts
import { getRegistry } from '../providers/registry';
import { db } from '../db'; // or wherever the drizzle DB instance is
import { frameworks, knowledgeItems, resultSets, resultRows } from '../db/schema';
import { buildFrameworkContext } from '../framework/context';
// Import Anthropic SDK for qualify_lead Claude call
// Import whatever types are needed

/**
 * search_leads: Create a lightweight workflow execution, run via provider registry.
 */
export async function handleSearchLeads(args: {
  query: string;
  count?: number;
  filters?: Record<string, unknown>;
}) {
  const registry = getRegistry();
  const executor = registry.resolve({ stepType: 'search', provider: 'mock' });

  const step = {
    stepIndex: 0,
    stepType: 'search',
    provider: executor.id,
    config: {
      query: args.query,
      count: args.count ?? 10,
      ...args.filters,
    },
  };

  const context = {
    frameworkContext: '', // Load from DB if available
    batchSize: args.count ?? 10,
    totalRequested: args.count ?? 10,
  };

  const allRows: Record<string, unknown>[] = [];
  for await (const batch of executor.execute(step, context)) {
    allRows.push(...batch.rows);
  }

  const columns = executor.getColumnDefinitions(step);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ resultCount: allRows.length, columns, rows: allRows }),
    }],
  };
}

/**
 * get_framework: Load the user's GTM framework from DB.
 */
export async function handleGetFramework(args: { sections?: string[] }) {
  // Load the most recent framework from the frameworks table
  // If args.sections is provided, filter to only those sections
  // Return the framework data
  const allFrameworks = await db.select().from(frameworks).limit(1);
  const framework = allFrameworks[0] ?? null;

  if (!framework) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ framework: null, message: 'No framework configured yet.' }) }],
    };
  }

  // If sections filter is provided, return only matching sections
  // The exact filtering depends on the framework's data shape — check GTMFramework type
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ framework }) }],
  };
}

/**
 * get_learnings: Load accumulated learnings.
 */
export async function handleGetLearnings(args: { confidence?: string; segment?: string }) {
  // Load learnings — check how they're stored (likely in frameworks.learnings or knowledgeItems)
  // Filter by confidence and segment if provided
  // Return array of Learning objects
  const items = await db.select().from(knowledgeItems);

  let filtered = items;
  if (args.confidence) {
    filtered = filtered.filter((i: any) => i.confidence === args.confidence);
  }
  if (args.segment) {
    filtered = filtered.filter((i: any) => i.segment === args.segment);
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ learnings: filtered }) }],
  };
}

/**
 * qualify_lead: Score a lead against ICP using Claude.
 */
export async function handleQualifyLead(args: { lead: Record<string, unknown>; segment?: string }) {
  // 1. Load framework context
  const allFrameworks = await db.select().from(frameworks).limit(1);
  const framework = allFrameworks[0];
  const frameworkContext = framework ? buildFrameworkContext(framework as any) : '';

  // 2. Load relevant learnings
  const learnings = await db.select().from(knowledgeItems);
  const relevantLearnings = args.segment
    ? learnings.filter((l: any) => l.segment === args.segment)
    : learnings;

  // 3. Call Claude to qualify
  // Use Anthropic SDK — import and instantiate client
  // System prompt: "You are a lead qualification expert. Score this lead 1-100 against the ICP."
  // Include: framework context, learnings, lead data
  // Parse response for: score (number), reason (string), matchedLearnings (array)

  // Placeholder until Claude integration:
  const score = 50;
  const reason = 'Qualification requires framework setup. Configure your ICP framework first.';
  const matchedLearnings: string[] = [];

  if (frameworkContext) {
    // TODO: Make actual Claude call here
    // const anthropic = new Anthropic();
    // const response = await anthropic.messages.create({ ... });
    // Parse score, reason, matchedLearnings from response
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ score, reason, matchedLearnings }),
    }],
  };
}

/**
 * get_available_providers: List all registered providers.
 */
export async function handleGetAvailableProviders() {
  const registry = getRegistry();
  const providers = registry.getAll();

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ providers }),
    }],
  };
}
```

**Notes:**
- The DB query patterns above are approximations. Read the actual schema and existing query patterns in the codebase to match them.
- The `qualify_lead` handler should make a real Claude API call when the framework is configured. Use the same Anthropic SDK pattern already used in `workflow-planner.ts` or `mock-engine.ts`.

---

### `src/app/api/mcp-server/route.ts`

SSE endpoint that serves the MCP server protocol over HTTP.

```ts
import { createGtmOsServer } from '@/lib/mcp/server';
// Import SSE transport from MCP SDK — check available server transports

export async function GET(request: Request) {
  // Auth check: bearer token
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.MCP_SERVER_TOKEN;

  if (!expectedToken) {
    return new Response('MCP server not configured', { status: 503 });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Create the MCP server and connect it to an SSE transport
  const server = createGtmOsServer();

  // The exact SSE serving pattern depends on the MCP SDK version.
  // Common pattern: create a ReadableStream, pipe MCP messages as SSE events.
  // Check the SDK for SSEServerTransport or similar.

  // Placeholder structure:
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      // Connect MCP server to this stream
      // Each MCP message becomes: data: {json}\n\n
      // This requires adapting the server's transport layer.
      // Check SDK examples for HTTP/SSE server usage.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(request: Request) {
  // Some MCP transports use POST for client→server messages
  const authHeader = request.headers.get('authorization');
  const expectedToken = process.env.MCP_SERVER_TOKEN;

  if (!expectedToken || !authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const server = createGtmOsServer();

  // Route the incoming JSON-RPC message to the server
  // Return the response
  // Exact implementation depends on SDK's transport API

  return Response.json({ error: 'Not implemented yet' }, { status: 501 });
}
```

**Critical implementation note:** The MCP SDK's server-side HTTP transport may work differently than the pattern above. Before implementing, check:
1. Does the SDK export `SSEServerTransport`? If so, use it.
2. Does it export `StreamableHTTPServerTransport`? That may be the newer pattern.
3. Look at the SDK's examples or README for HTTP server usage.
4. The GET route should handle the SSE connection. The POST route should handle incoming JSON-RPC messages from the client.

Adapt the implementation to whatever the SDK actually provides. The auth check pattern is correct regardless.

---

### `src/components/mcps/McpServerSettings.tsx`

Settings panel for exposing GTM-OS as an MCP server. Displayed on the MCPs page.

```tsx
'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils'; // or wherever cn() lives

export default function McpServerSettings() {
  const [enabled, setEnabled] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Tools that can be enabled/disabled individually
  const [toolToggles, setToolToggles] = useState({
    search_leads: true,
    get_framework: true,
    get_learnings: true,
    qualify_lead: true,
    get_available_providers: true,
  });

  const connectionUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/mcp-server`
    : '';

  useEffect(() => {
    // Fetch current server settings from API or localStorage
    // Load enabled state and token
  }, []);

  const handleToggle = async () => {
    if (!enabled) {
      // Enable: generate token, save settings
      const newToken = crypto.randomUUID();
      setToken(newToken);
      setEnabled(true);
      // POST to an API to save the token (or store in env/DB)
    } else {
      // Disable
      setEnabled(false);
      setToken(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold font-mono">GTM-OS as MCP Server</h3>
          <p className="text-sm text-muted-foreground">
            Allow external AI agents to access your GTM-OS data and capabilities.
          </p>
        </div>
        <button
          onClick={handleToggle}
          className={cn(
            'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
            enabled ? 'bg-matcha' : 'bg-muted'
          )}
        >
          <span
            className={cn(
              'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
              enabled ? 'translate-x-6' : 'translate-x-1'
            )}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 pt-2 border-t">
          {/* Connection URL */}
          <div>
            <label className="text-sm font-medium">Connection URL</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono truncate">
                {connectionUrl}
              </code>
              <button
                onClick={() => copyToClipboard(connectionUrl)}
                className="px-3 py-2 text-sm border rounded hover:bg-muted"
              >
                Copy
              </button>
            </div>
          </div>

          {/* Auth Token */}
          <div>
            <label className="text-sm font-medium">Auth Token</label>
            <div className="flex items-center gap-2 mt-1">
              <code className="flex-1 px-3 py-2 bg-muted rounded text-sm font-mono truncate">
                {token ? `${token.slice(0, 8)}...${token.slice(-4)}` : '---'}
              </code>
              <button
                onClick={() => token && copyToClipboard(token)}
                className="px-3 py-2 text-sm border rounded hover:bg-muted"
              >
                {copied ? 'Copied' : 'Copy Full Token'}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Pass this as a Bearer token in the Authorization header.
            </p>
          </div>

          {/* Tool Toggles */}
          <div>
            <label className="text-sm font-medium">Exposed Tools</label>
            <div className="mt-2 space-y-2">
              {Object.entries(toolToggles).map(([tool, enabled]) => (
                <label key={tool} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() =>
                      setToolToggles(prev => ({ ...prev, [tool]: !prev[tool] }))
                    }
                    className="rounded border-muted"
                  />
                  <code className="font-mono text-xs">{tool}</code>
                </label>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="flex items-center gap-2 text-sm">
            <span className={cn('h-2 w-2 rounded-full', enabled ? 'bg-matcha' : 'bg-muted')} />
            <span>{enabled ? 'Server active' : 'Server inactive'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Notes:**
- The color classes (`bg-matcha`, `bg-pomegranate`, `text-muted-foreground`, etc.) should match the design system already in use. Check existing components for exact class names.
- Token storage: ideally save to DB or `.env.local`. For v1, saving to `localStorage` + passing via API header is acceptable. The `MCP_SERVER_TOKEN` env var in the route handler should match.
- This is a v1 implementation. Token generation and persistence can be hardened later.

---

## Existing Files to Modify

### `src/components/mcps/McpsView.tsx`

Add the "GTM-OS as Server" section below the existing Connected Servers section.

1. Import `McpServerSettings`:
   ```ts
   import McpServerSettings from './McpServerSettings';
   ```

2. Add a new section after the Connected Servers grid and before or after the Add Server form:
   ```tsx
   {/* GTM-OS as MCP Server */}
   <section className="space-y-4">
     <h2 className="text-xl font-semibold font-mono">GTM-OS as MCP Server</h2>
     <McpServerSettings />
   </section>
   ```

Place this section visually separated (e.g., with a divider or margin) so it is clearly distinct from the "connect to external servers" section above it.

---

## Verification Steps

Run these in order. Every one must pass.

1. **`pnpm dev`** — app starts without errors.
2. **Navigate to `/mcps`** — page shows the new "GTM-OS as MCP Server" section with the toggle (off by default).
3. **Enable the toggle** — connection URL and auth token appear. All 5 tool checkboxes are checked.
4. **Copy the connection URL and token.**
5. **Test the endpoint with curl:**
   ```bash
   # Without token — should return 401
   curl -i http://localhost:3000/api/mcp-server

   # With token — should establish SSE connection or return valid MCP response
   curl -i -H "Authorization: Bearer YOUR_TOKEN" http://localhost:3000/api/mcp-server
   ```
6. **Test `get_available_providers`** — make a JSON-RPC call to the MCP server endpoint and verify it returns the provider list (at minimum the mock provider).
7. **Test `get_framework`** — returns either the framework data or a "no framework configured" message.
8. **Disable the toggle** — requests to the endpoint should be rejected (503 or 401).
9. **`pnpm build`** — production build completes with zero errors.

---

## Commit Message

```
feat: expose GTM-OS as MCP server (4.3)
```
