# Fiber AI integration

> **Tip:** ask Claude Code in your IDE to run any of these commands. See the [Quick start](../README.md#quick-start) in the README.

Fiber AI is a unified contact and company data API. GTM-OS uses Fiber as one of the providers for:

| Capability | What it does |
|---|---|
| `people-search` | Find candidate profiles by free-text query, company, title, or location. |
| `email-enrich` | Resolve a verified business email from a LinkedIn URL or name + company. |

Fiber exposes both capabilities through MCP servers (`fiber-core` and `fiber-v2`). The curated `fiber-v2` server handles every common search and live-enrich call; `fiber-core` is the broader meta-tool surface used only when the curated server does not expose the operation you need.

## Coverage caveat (read this first)

Fiber's US coverage is strong. **EU phone coverage is effectively 0%** as of 2026-06. If your ICP is European and you need phone numbers, configure FullEnrich as the fallback provider (already wired) and Fiber will be skipped for that branch.

US emails are reliable. EU emails are decent. EU phones, plan around.

## Setup (one time)

1. Sign up at https://app.fiber.ai.
2. In the dashboard, open **Settings, API keys** and create a new key.
3. Add the key to `~/.gtm-os/.env` (or your repo's `.env.local`):
   ```
   FIBER_API_KEY=<value>
   ```
4. Register the MCP servers in your local MCP config. Copy the shipped configs into `~/.gtm-os/mcp/`:
   ```bash
   mkdir -p ~/.gtm-os/mcp
   cp configs/mcp/fiber-core.json ~/.gtm-os/mcp/
   cp configs/mcp/fiber-v2.json   ~/.gtm-os/mcp/
   ```
5. Verify the loader sees both servers:
   ```bash
   npx tsx src/cli/index.ts provider:list
   ```
   You should see `fiber-core` and `fiber-v2` listed with status `active`.

## Verify with a smoke test

Once the key is set, run a single people-search against a known US company:

```bash
npx tsx src/cli/index.ts orchestrate "find the VP of Engineering at Anthropic"
```

The orchestrator should resolve `people-search` to the `fiber` provider and return at least one row.

## What lives where

| File | Purpose |
|---|---|
| `configs/mcp/fiber-core.json` | MCP server config for the broader Fiber surface. |
| `configs/mcp/fiber-v2.json` | MCP server config for the curated Fiber v2 tools. |
| `providers/manifests/people-search/fiber.yaml` | Capability manifest binding `people-search` to Fiber's `peopleSearch_tool`. |
| `providers/manifests/email-enrich/fiber.yaml` | Capability manifest binding `email-enrich` to Fiber's `profileLiveEnrich_tool`. |
| `configs/adapters/people-search-fiber.yaml` | Bundled copy loaded at boot. |
| `configs/adapters/email-enrich-fiber.yaml` | Bundled copy loaded at boot. |

## Authentication note

Fiber expects the API key in two places: the `x-api-key` HTTP header and as an `apiKey` field in the request body. The shipped manifests handle both. If you write a custom Fiber call by hand, include both or the call will return `401`.

## Provider roles

Fiber is the **people-search** provider in this repo: given a company and a role pattern, it returns candidate profiles. Email and phone enrichment goes through **FullEnrich** via the `people-enrich-fullenrich` adapter, not through Fiber. This split keeps the enrichment partnership story clean.
