# Enrichment & Provider Rules

Applies to: `src/lib/enrichment/`, `src/lib/providers/`, `configs/mcp/`

## Context to Load
- `~/.gtm-os/framework.yaml` — company context and ICP definition
- `docs/providers.md` — provider setup and capabilities reference
- `src/lib/providers/types.ts` — the StepExecutor interface all providers implement

## Hard Rules
1. **All enrichment goes through the provider registry** (`src/lib/providers/registry.ts`). Never call external APIs directly.
2. **Credit tracking is mandatory** for every provider call. Check `src/lib/providers/stats.ts` for the tracking pattern.
3. **MCP providers** load from `~/.gtm-os/mcp/*.json` — see MCP loader in `src/lib/providers/` for the dynamic loading pattern.
4. Provider errors must be caught and returned as structured `ProviderError` objects, never thrown as raw exceptions.
5. New providers must register in `src/lib/providers/builtin/index.ts` and export from the barrel.

## Provider Implementation Checklist
- [ ] Implements `StepExecutor` from `src/lib/providers/types.ts`
- [ ] Registered in provider registry
- [ ] Credit cost documented in provider metadata
- [ ] Rate limiting configured (see `src/lib/rate-limiter/`)
- [ ] Error handling returns `ProviderError` with actionable messages
