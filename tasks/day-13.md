# Day 13 — Lean Architecture: Replace Orthogonal with Direct API Skills

**Date:** 2026-03-16
**Source:** Architecture audit of full codebase + Earleads second brain skill inventory
**Build status:** Compiles clean. This brief restructures the entire provider layer.

---

## What you're building

**One principle: every API call goes directly to its destination. No middleware.**

Orthogonal was a meta-API gateway: semantic search to discover an API, then execute it. Two round-trips for every single data call. Today we rip it out entirely and replace it with 3 purpose-built service modules that call their APIs directly:

- **Unipile** — LinkedIn search, profile enrichment, messaging (via `unipile-node-sdk`)
- **Firecrawl** — Web search, scraping, structured extraction (via `@mendable/firecrawl-js`)
- **Notion** — Lead storage, database operations (via `@notionhq/client`)
- **Anthropic** — Already exists, unchanged

After today:
1. Zero Orthogonal references in the codebase
2. Three new service classes wrapping real SDKs
3. Three new providers implementing `StepExecutor`
4. Workflow planner routes to the right provider automatically (LinkedIn → Unipile, web → Firecrawl)
5. Dead code from the web UI era cleaned from CLAUDE.md
6. Auth tables stripped from DB schema
7. CLI-only project — all web UI references removed permanently

---

## Read first

Before writing code, read these files in order:

1. `src/lib/providers/types.ts` — `StepExecutor` interface (your contract for new providers)
2. `src/lib/providers/registry.ts` — how providers register + resolve (you'll modify this)
3. `src/lib/providers/builtin/orthogonal.ts` — the provider you're REPLACING (study the pattern, then delete it)
4. `src/lib/providers/builtin/qualify-provider.ts` — a clean provider example to follow (KEEP this)
5. `src/lib/ai/workflow-planner.ts` — `buildWorkflowFromAction()` hardcodes `provider: 'orthogonal'` (you'll fix this)
6. `src/lib/ai/types.ts` — `ApiProvider` union has `'orthogonal'` (remove it, add new ones)
7. `src/lib/execution/columns.ts` — `SEARCH_COLUMNS` (your providers will reference these)
8. `src/lib/web/fetcher.ts` — `fetchViaFirecrawl()` uses MCP lookup (simplify to direct SDK call)
9. `src/lib/db/schema.ts` — 21 tables, 4 auth tables to strip
10. `CLAUDE.md` — ~300 lines, ~50% stale web UI content (rewrite for CLI-only)

Also read these Earleads skills for reference implementations:
- `~/bin/unipile/cli.mjs` — how the Unipile SDK is called (method names, patterns)
- The Firecrawl API docs at `https://docs.firecrawl.dev/api-reference/` — v2 endpoints

---

## Environment Variables

Users bring their own keys. All 5 must be documented:
```
ANTHROPIC_API_KEY   — Claude API (already exists)
UNIPILE_API_KEY     — Unipile access token
UNIPILE_DSN         — Unipile base URL (e.g. https://api18.unipile.com:14891)
FIRECRAWL_API_KEY   — Firecrawl API key
NOTION_API_KEY      — Notion integration token
```

---

## Phase A: Install Dependencies (Sub-task 1)

Add to `package.json` dependencies:
```json
"unipile-node-sdk": "^1.0.0",
"@mendable/firecrawl-js": "^1.0.0",
"@notionhq/client": "^2.0.0"
```

Run `pnpm install`. Then **read the `.d.ts` files** in node_modules for each SDK to verify exact method signatures before writing any service code. The Unipile SDK methods may differ from what `cli.mjs` uses.

Verify: `pnpm typecheck` still passes.

---

## Phase B: Create Service Layer (Sub-tasks 2-4)

Create `src/lib/services/` directory with 3 files. Each is a singleton service wrapping one SDK.

### Sub-task 2: `src/lib/services/unipile.ts`

Singleton `UnipileClient` from `unipile-node-sdk`, lazy-initialized from `UNIPILE_API_KEY` + `UNIPILE_DSN`.

`UnipileService` class methods:
- `isAvailable(): boolean` — checks env vars
- `getAccounts()` — list connected LinkedIn accounts
- `getProfile(accountId, slug)` — get LinkedIn profile by public slug
- `searchLinkedIn(accountId, query, limit)` — search LinkedIn people
- `sendConnection(accountId, providerId, message?)` — send invite
- `sendMessage(accountId, attendeeId, text)` — send DM
- `listRelations(accountId)` — detect accepted connections
- `getPost(accountId, postUrl)` — resolve post URL → social_id
- `listPostReactions(accountId, postId)` — get likers
- `listPostComments(accountId, postId)` — get commenters

Export `unipileService` singleton.

**CRITICAL:** After `pnpm install`, read `node_modules/unipile-node-sdk/dist/index.d.ts` to get exact method names. The SDK uses `client.account.getAll()`, `client.users.*`, `client.messaging.*`. Match exactly.

### Sub-task 3: `src/lib/services/firecrawl.ts`

Singleton `FirecrawlApp` from `@mendable/firecrawl-js`, lazy-initialized from `FIRECRAWL_API_KEY`.

`FirecrawlService` class methods:
- `isAvailable(): boolean`
- `scrape(url): Promise<string>` — single URL → markdown
- `search(query, limit): Promise<{url, title, content}[]>` — web search + content
- `extract(url, schema): Promise<unknown>` — LLM-powered structured extraction
- `map(url, limit): Promise<string[]>` — discover all URLs on a domain

Export `firecrawlService` singleton.

**CRITICAL:** Check `node_modules/@mendable/firecrawl-js` for exact API — methods may be `scrapeUrl()` not `scrape()`, etc.

### Sub-task 4: `src/lib/services/notion.ts`

Singleton `Client` from `@notionhq/client`, lazy-initialized from `NOTION_API_KEY`.

`NotionService` class methods:
- `isAvailable(): boolean`
- `queryDatabase(databaseId, filter?)` — paginated query, returns all pages
- `createPage(databaseId, properties)` — create single page
- `updatePage(pageId, properties)` — update page properties
- `search(query, filter?)` — search workspace
- `bulkCreateLeads(databaseId, leads[], titleField)` — batch create with 40-page batches

Export `notionService` singleton.

---

## Phase C: Create Providers (Sub-tasks 5-7)

Each implements `StepExecutor` from `src/lib/providers/types.ts`. Follow the pattern of `qualify-provider.ts` (clean, well-structured).

### Sub-task 5: `src/lib/providers/builtin/firecrawl-provider.ts`

- `id: 'firecrawl'`, `type: 'builtin'`, `capabilities: ['search', 'enrich']`
- `canExecute`: claims `search`/`enrich` steps where `provider === 'firecrawl'` or generic web search
- `execute`:
  - If `config.url` → `firecrawlService.scrape(url)`
  - If enrich + previousStepRows → scrape each row's website
  - Else → `firecrawlService.search(query, totalRequested)`
- `getColumnDefinitions`: returns `SEARCH_COLUMNS`

### Sub-task 6: `src/lib/providers/builtin/unipile-provider.ts`

- `id: 'unipile'`, `type: 'builtin'`, `capabilities: ['search', 'enrich']`
- `canExecute`: claims steps where `provider === 'unipile'` OR description/query contains "linkedin"
- `execute`:
  - Gets first LinkedIn account via `getAccounts()`
  - If enrich → `getProfile()` for each row's LinkedIn slug
  - Else → `searchLinkedIn(accountId, query, limit)`
- `normalizeProfile()`: flattens SDK response to `{company_name, website, industry, location, description, linkedin_url, first_name, last_name, title, ...}`
- `getColumnDefinitions`: extends `SEARCH_COLUMNS` with `first_name`, `last_name`, `title`, `linkedin_url`

### Sub-task 7: `src/lib/providers/builtin/notion-provider.ts`

- `id: 'notion'`, `type: 'builtin'`, `capabilities: ['export']`
- `canExecute`: claims `export` steps with `config.notionDatabaseId`
- `execute`: takes `previousStepRows` → `bulkCreateLeads()` → yields `{exported: N, database_id, status}`
- `getColumnDefinitions`: `[exported (number), database_id (text), status (badge)]`

---

## Phase D: Wire New Providers, Remove Orthogonal (Sub-tasks 8-12)

### Sub-task 8: Update `src/lib/providers/builtin/index.ts`
- Remove: `export { OrthogonalProvider } from './orthogonal'`
- Add exports for `FirecrawlProvider`, `UnipileProvider`, `NotionProvider`

### Sub-task 9: Update `src/lib/providers/registry.ts`
- Remove: OrthogonalProvider import + registration
- Add: FirecrawlProvider, UnipileProvider, NotionProvider imports + registrations
- Registration order: Mock → Qualify → Firecrawl → Unipile → Notion
- Remove stale "no intelligence layer needed with Orthogonal" comment

### Sub-task 10: Update `src/lib/ai/types.ts`
- Remove `'orthogonal'` from `ApiProvider` union + `PROVIDER_LABELS`
- Add `'unipile'` and `'notion'` (`'firecrawl'` already exists)

### Sub-task 11: Update `src/lib/ai/workflow-planner.ts`
In `buildWorkflowFromAction()`:
- `find_leads`: detect LinkedIn (URL contains "linkedin.com" or query contains "linkedin") → `provider: 'unipile'`, else → `provider: 'firecrawl'`. Update `requiredApiKeys`.
- `enrich_leads`: same LinkedIn detection. Update `requiredApiKeys`.
- `qualify_leads`: unchanged.

### Sub-task 12: Update `src/lib/web/fetcher.ts`
Replace `fetchViaFirecrawl()`: instead of MCP registry lookup, import `firecrawlService` directly and call `scrape(url)`. Removes circular dependency.

---

## Phase E: Delete Dead Code (Sub-task 13-14)

### Sub-task 13: Delete files
**MUST happen after sub-tasks 8-9 (registry no longer imports them).**

```
DELETE src/lib/providers/builtin/orthogonal.ts
DELETE src/lib/providers/builtin/orthogonal-token.ts
DELETE scripts/orth-search.sh
DELETE scripts/orth-run.sh
DELETE scripts/enrich-commenters.py
DELETE scripts/research.sh
DELETE vercel.json
```

Verify: `pnpm typecheck` passes.

### Sub-task 14: Strip auth tables from `src/lib/db/schema.ts`
Delete table definitions: `users`, `accounts`, `sessions`, `verificationTokens` (NextAuth remnants, zero code depends on them). Note: `frameworks.userId` is plain text with `.default('default')` — NOT a foreign key — safe to keep.

---

## Phase F: Update Config & Docs (Sub-tasks 15-17)

### Sub-task 15: Replace `tasks/api/*.yaml`
Delete 5 Orthogonal YAMLs. Create 4 new:
- `search_linkedin_unipile.yaml`
- `search_web_firecrawl.yaml`
- `store_leads_notion.yaml`
- `qualify_leads_claude.yaml`

Each describes: id, name, description, provider, env_required, capabilities, best_for.

### Sub-task 16: Update `gtm-os.yaml`
Replace `connected_providers: ["orthogonal"]` → `["firecrawl", "unipile", "notion", "anthropic"]`

### Sub-task 17: Rewrite `CLAUDE.md`

**DELETE sections:** API Patterns (SSE), UI Conventions, Design Workflow & Tools, Pre-Delivery Design Checklist, Onboarding System, File Map (all reference deleted web UI).

**REWRITE sections:**
- Product Identity: "pure TypeScript library + CLI. No web UI."
- Tech Stack: remove Next.js/Tailwind/Jotai/Vercel
- Architecture Overview: CLI-only
- Provider System: Firecrawl + Unipile + Notion + Qualify
- CLI Kernel Section 1: new env vars
- CLI Kernel Sections 3a/3c/3d: new providers (not orth scripts)
- CLI Kernel Section 4: new provider decision tree:
  1. LinkedIn? → Unipile
  2. Web search/scrape? → Firecrawl
  3. AI qualification? → QualifyProvider
  4. Store leads? → Notion
  5. Missing key? → tell user which env var

**KEEP sections:** Framework System, RLHF, Skills System, Intelligence, Conventions, CLI Kernel Sections 5-11.

---

## Phase G: Verification (Sub-task 18)

1. `pnpm typecheck` exits 0
2. `grep -r "orthogonal" src/` returns zero results
3. `grep -r "orth-search\|orth-run" .` returns zero results (excluding node_modules)
4. Provider registry lists: firecrawl, unipile, notion, qualify, mock (no orthogonal)
5. No imports of deleted files remain

---

## Dependency graph

```
1 (pnpm install)
 ├→ 2 (UnipileService)  ─→ 6 (UnipileProvider)  ─┐
 ├→ 3 (FirecrawlService) → 5 (FirecrawlProvider) ─┤→ 8 (index) → 9 (registry) → 13 (delete)
 └→ 4 (NotionService)  ─→ 7 (NotionProvider)  ───┘
                                                    ├→ 10 (types.ts)
                                                    ├→ 11 (workflow-planner)
                                                    └→ 12 (web/fetcher)
Independent after 13: 14 (schema) | 15 (YAMLs) | 16 (yaml) | 17 (CLAUDE.md)
Final: 18 (verify)
```

## Files summary

| Action | File |
|--------|------|
| CREATE | `src/lib/services/unipile.ts` |
| CREATE | `src/lib/services/firecrawl.ts` |
| CREATE | `src/lib/services/notion.ts` |
| CREATE | `src/lib/providers/builtin/firecrawl-provider.ts` |
| CREATE | `src/lib/providers/builtin/unipile-provider.ts` |
| CREATE | `src/lib/providers/builtin/notion-provider.ts` |
| CREATE | `tasks/api/search_linkedin_unipile.yaml` |
| CREATE | `tasks/api/search_web_firecrawl.yaml` |
| CREATE | `tasks/api/store_leads_notion.yaml` |
| CREATE | `tasks/api/qualify_leads_claude.yaml` |
| MODIFY | `package.json` |
| MODIFY | `src/lib/providers/builtin/index.ts` |
| MODIFY | `src/lib/providers/registry.ts` |
| MODIFY | `src/lib/ai/types.ts` |
| MODIFY | `src/lib/ai/workflow-planner.ts` |
| MODIFY | `src/lib/web/fetcher.ts` |
| MODIFY | `src/lib/db/schema.ts` |
| MODIFY | `gtm-os.yaml` |
| REWRITE | `CLAUDE.md` |
| DELETE | `src/lib/providers/builtin/orthogonal.ts` |
| DELETE | `src/lib/providers/builtin/orthogonal-token.ts` |
| DELETE | `scripts/orth-search.sh`, `orth-run.sh`, `enrich-commenters.py`, `research.sh` |
| DELETE | `vercel.json` |
| DELETE | `tasks/api/` (5 old YAMLs) |
