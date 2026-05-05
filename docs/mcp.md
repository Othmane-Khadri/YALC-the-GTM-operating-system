# MCP Integration

> **Tip:** you can run any of these commands by asking Claude Code in your IDE — see [Quick start in README](../README.md#quick-start).

## Claude Code MCP vs YALC MCP — at a glance

YALC and Claude Code both have a thing called "MCP". They are different
registries, live in different files, and serve different processes. Read this
table before adding or editing any config.

| Aspect | Claude Code MCP | YALC MCP |
|---|---|---|
| Used by | Claude Code itself, when you chat in the IDE | YALC's CLI providers — `provider:list`, `provider:add`, doctor |
| Config location | `.mcp.json` (project) or `~/.claude.json` (user) | `~/.gtm-os/mcp/<name>.json` (one file per provider) |
| Loader | Claude Code reads at startup of each chat | `getMcpConfigDir()` in `src/lib/providers/mcp-loader.ts` |
| Schema | Claude Code's MCP server descriptor | YALC provider config (capabilities, healthCheck, env) |
| Edited by | `claude mcp add ...` or hand-editing | `yalc-gtm provider:add --mcp <name>` |

Rule of thumb: **never** point `provider:add` or any YALC tool at a
`.mcp.json` / `~/.claude.json` path. YALC will refuse and redirect to
`~/.gtm-os/mcp/`.

## What is MCP?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard for connecting AI models to external tools and data sources. GTM-OS supports MCP as a provider type alongside built-in providers.

## Current Status

GTM-OS has MCP infrastructure in place but does not ship pre-built MCP servers yet:

- **Provider type system** supports `'mcp'` alongside `'builtin'` and `'mock'`
- **Database schema** includes an `mcpServers` table for storing MCP server configurations
- **Execution context** passes an `mcpClient` field to providers
- **MCP server endpoint** available at `/api/mcp-server` (protected by `MCP_SERVER_TOKEN`)

## How MCP Will Work

When MCP servers are connected, they integrate through the Provider Registry just like built-in providers:

```
Skill requests "search" capability
  → Provider Registry checks:
    1. Built-in providers (Crustdata, Firecrawl, etc.)
    2. Connected MCP servers with matching capabilities
    3. Best match wins (based on Provider Intelligence scores)
```

This means existing skills automatically work with new MCP providers — no code changes needed. A `find-companies` skill that uses Crustdata today will seamlessly use an Apollo MCP server tomorrow if one is connected and scores higher.

## Planned MCP Integrations

From the systems architecture roadmap:

| Tool | Integration Type | Data |
|------|-----------------|------|
| HeyReach | MCP or API | LinkedIn automation metrics |
| Lemlist | MCP or API | Email sequence performance |
| Social Pilot | MCP or API | Social media analytics |
| Google Search Console | API | SEO rankings, clicks, impressions |

## Adding Your Own MCP

To add a custom MCP server (one that isn't shipped as a template), drop a JSON config file anywhere on disk and point `provider:add` at it:

```bash
# 1. Write your config (anywhere)
cat > /tmp/pipedrive.json <<'EOF'
{
  "name": "pipedrive",
  "command": "npx",
  "args": ["-y", "@pipedrive/mcp-server"],
  "env": { "PIPEDRIVE_API_TOKEN": "${PIPEDRIVE_API_TOKEN}" }
}
EOF

# 2. Register it
yalc-gtm provider:add --mcp /tmp/pipedrive.json

# 3. Verify
yalc-gtm provider:test pipedrive
```

The config is copied to `~/.gtm-os/mcp/<name>.json` (the `name` field decides the filename, not the input path). Pass `--force` to overwrite an existing provider of the same name. The `${ENV_VAR}` syntax inside any string field is expanded at load time from your shell environment / `.env`.

## Connecting External MCP Servers

When MCP server support is fully shipped, connection will work like this:

1. Set `MCP_SERVER_TOKEN` in `.env.local`
2. Register the MCP server via CLI or config
3. The server's tools become available as providers
4. Skills automatically discover and use them

## Building an MCP Provider

If you want to contribute an MCP provider:

1. Create a provider that implements the `StepExecutor` interface
2. Set `type: 'mcp'` instead of `'builtin'`
3. Declare capabilities (search, enrich, export, etc.)
4. The Provider Registry handles the rest

See `docs/ARCHITECTURE.md` and `src/lib/providers/types.ts` for the interface definition.

## Using GTM-OS as an MCP Server

GTM-OS itself can act as an MCP server, exposing its capabilities to other AI tools:

- Endpoint: `/api/mcp-server`
- Auth: Bearer token via `MCP_SERVER_TOKEN` env var
- This lets external AI agents (Claude Code, other tools) use GTM-OS skills as tools

To enable:
```bash
# Add to .env.local
MCP_SERVER_TOKEN=your-generated-token  # openssl rand -hex 32
```
