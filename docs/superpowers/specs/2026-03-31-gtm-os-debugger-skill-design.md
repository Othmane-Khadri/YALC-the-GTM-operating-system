# GTM-OS Debugger Skill — Design Spec

## Context

GTM-OS is a CLI-first TypeScript system distributed to users who run it inside Claude Code. It has 8 providers (Unipile, Firecrawl, Crustdata, FullEnrich, Notion, Instantly, Qualify, Mock), 17 database tables, YAML-based configuration, and AES-256-GCM encrypted API key storage. Users will inevitably encounter setup and runtime bugs — missing env vars, broken provider connectivity, DB migration issues, config syntax errors. Today, errors are raw stack traces with no guided resolution.

This skill gives Claude Code the domain knowledge to diagnose and fix GTM-OS issues automatically when they occur, turning every error into a guided resolution flow.

## Deliverable

A Claude Code skill shipping inside the GTM-OS repo at `.claude/skills/debugger/`.

### File Structure

```
.claude/skills/debugger/
├── SKILL.md                          # Main diagnostic playbook + base context
├── config/
│   ├── error-catalog.md              # Known errors → root causes → fixes
│   └── diagnostic-procedures.md      # Bash commands for each diagnostic check
```

## Trigger

**Skill router entry in CLAUDE.md:**
- "debug" / "fix" / "not working" / "error" / "broken" / "troubleshoot" → debugger

**Auto-activation:** A CLAUDE.md instruction tells Claude Code: "When any CLI command fails with an error, activate the debugger skill before attempting any manual fix." This ensures the structured diagnostic funnel runs instead of ad-hoc troubleshooting.

## SKILL.md Content Design

### Section 1: Base Context (GTM-OS Architecture)

Condensed reference so Claude Code can reason about errors without reading the full codebase:

**System overview:**
- CLI-first TypeScript system. Entry: `src/cli/index.ts` via `npx tsx`.
- Env loading: `.env.local` via `loadEnv()` at CLI startup.
- Config: `~/.gtm-os/config.yaml` (user prefs) + `gtm-os.yaml` (GTM framework).

**Three-layer pattern:**
- Service (`src/lib/services/`) — SDK wrappers, singleton clients
- Provider (`src/lib/providers/builtin/`) — StepExecutor implementations
- Skill (`src/lib/skills/`) — User-facing composable operations

**Provider dependency matrix:**

| Provider | Required Env Vars | Health Check Method |
|----------|------------------|---------------------|
| Qualify | `ANTHROPIC_API_KEY` | Key format check |
| Firecrawl | `FIRECRAWL_API_KEY` | 5s timeout scrape test |
| Unipile | `UNIPILE_API_KEY` + `UNIPILE_DSN` | `getAccounts()` call |
| Notion | `NOTION_API_KEY` | Light `search()` call |
| Crustdata | `CRUSTDATA_API_KEY` | Key format check |
| FullEnrich | `FULLENRICH_API_KEY` | Key format check |
| Instantly | `INSTANTLY_API_KEY` | — |

**Critical files map:**

| Issue Domain | Where to Look |
|-------------|---------------|
| Environment | `.env.local`, `.env.example` |
| Database | `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `drizzle.config.ts` |
| Providers | `src/lib/services/{provider}.ts`, `src/lib/providers/builtin/{provider}-provider.ts` |
| Framework | `gtm-os.yaml`, `src/lib/framework/context.ts` |
| Config | `~/.gtm-os/config.yaml`, `src/lib/config/loader.ts` |
| Encryption | `src/lib/crypto.ts` |
| Rate limits | `src/lib/rate-limiter/index.ts` |
| CLI entry | `src/cli/index.ts` |

### Section 2: The 5-Layer Diagnostic Funnel

When an error occurs, run through layers in order. Each layer short-circuits — if the issue is found, stop and offer the fix. Never skip to expensive checks before exhausting cheap ones.

**Layer 1: Environment Validation (FREE — file reads only)**
- `.env.local` exists
- Required vars set: `ANTHROPIC_API_KEY`, `DATABASE_URL`, `ENCRYPTION_KEY`
- Provider-specific vars present for the failing provider
- Format validation: `UNIPILE_DSN` matches `https://api{N}.unipile.com:{PORT}`
- No trailing whitespace or quotes around values

**Layer 2: Database Validation (FREE — local file/query)**
- DB file exists at `DATABASE_URL` path (or Turso reachable)
- Core tables exist (run `SELECT name FROM sqlite_master WHERE type='table'`)
- FTS5 virtual table `knowledge_fts` exists
- WAL mode enabled (`PRAGMA journal_mode`)
- Foreign keys enabled (`PRAGMA foreign_keys`)
- No pending migrations (`pnpm db:push --dry-run` if available)

**Layer 3: Configuration Validation (FREE — file reads)**
- `gtm-os.yaml` exists at project root
- Valid YAML syntax (parse attempt)
- `onboarding_complete: true` is set
- `~/.gtm-os/config.yaml` exists and is valid YAML
- Notion DS IDs are 36-char UUID format
- No circular references or invalid types

**Layer 4: Provider Connectivity (1 API call per provider)**
- Only test the provider involved in the error
- Run the provider's health check method
- Check response for auth errors vs. network errors vs. rate limits
- Verify Unipile has a connected LinkedIn account (`getAccounts()`)
- Check Crustdata credit balance if applicable

**Layer 5: Deep Diagnosis (varies)**
- Parse the full stack trace
- Identify the failing function and file
- Read the relevant source code
- Check rate limit bucket state in DB
- Inspect encrypted API key format in `api_connections` table
- Check for concurrent access issues (WAL locks)
- Review recent command history for patterns

### Section 3: Auto-Fix Procedures

Each fix follows this pattern:
1. Diagnose → explain the root cause in plain language
2. Show the proposed fix (diff, command, or action)
3. Ask for user approval
4. Apply the fix
5. Re-run the original command to verify

**Fix categories:**

| Fix Type | Approval Level | Example |
|----------|---------------|---------|
| Add missing env var | Standard | "Add `UNIPILE_DSN=...` to .env.local?" |
| Run DB migration | Standard | "Run `pnpm db:push` to create missing tables?" |
| Fix YAML syntax | Standard | Show diff of corrected YAML |
| Generate encryption key | Standard | "Generate key with `openssl rand -hex 32`?" |
| Reset encryption + re-encrypt | **Destructive warning** | "This will invalidate stored API keys. Proceed?" |
| Reset database | **Destructive warning** | "This deletes all data. Are you sure?" |
| Rotate provider key | Standard | Guide through provider dashboard |

### Section 4: Unresolved Error Handling

If all 5 layers pass but the error persists:
1. Collect a diagnostic report (env status, DB status, provider status, error + stack trace)
2. Format it as a GitHub issue template
3. Offer to copy it to clipboard or save to `./debug-report-{timestamp}.md`
4. Suggest: "This looks like a new issue. You can file it at the GTM-OS GitHub Issues page." (The actual URL is set in CLAUDE.md at implementation time.)

## Error Catalog Structure (config/error-catalog.md)

Organized by layer. Each entry:

```markdown
## {LAYER}_{NUMBER}: {Short description}

**Error patterns:** (regex or string matches)
- `exact error message`
- `/regex pattern/`

**Layer:** {1-5}
**Root cause:** {Plain language explanation}
**Diagnostic commands:**
- `command 1`
- `command 2`

**Auto-fix:**
1. Step 1
2. Step 2

**Approval level:** Standard | Destructive
**Severity:** Blocking | Degraded | Cosmetic
```

### Known Errors to Catalog (initial set)

**Layer 1 — Environment:**
- ENV_001: Missing `ANTHROPIC_API_KEY`
- ENV_002: Missing `UNIPILE_DSN` (has key but no DSN)
- ENV_003: Invalid `UNIPILE_DSN` format (wrong protocol, missing port)
- ENV_004: Missing `ENCRYPTION_KEY`
- ENV_005: Missing `.env.local` file entirely
- ENV_006: `DATABASE_URL` points to non-writable path
- ENV_007: Turso URL without `TURSO_AUTH_TOKEN`

**Layer 2 — Database:**
- DB_001: Database file doesn't exist
- DB_002: Missing core tables (migration not run)
- DB_003: FTS5 virtual table missing
- DB_004: WAL mode not enabled
- DB_005: Foreign key constraint violation on insert
- DB_006: Database locked (concurrent access)

**Layer 3 — Configuration:**
- CFG_001: Missing `gtm-os.yaml`
- CFG_002: Invalid YAML syntax in `gtm-os.yaml`
- CFG_003: `onboarding_complete` is false/missing
- CFG_004: Missing `~/.gtm-os/config.yaml`
- CFG_005: Invalid Notion DS ID format
- CFG_006: Missing `HOME` environment variable

**Layer 4 — Provider:**
- PRV_001: Unipile — no LinkedIn account connected
- PRV_002: Unipile — DSN rotated (account not found)
- PRV_003: Firecrawl — API key expired or invalid
- PRV_004: Notion — insufficient API token scopes
- PRV_005: Crustdata — credits exhausted
- PRV_006: Provider not found (with Levenshtein suggestion)
- PRV_007: Rate limit exceeded for provider

**Layer 5 — Runtime:**
- RT_001: Notion "Request body too large" (batch > 40)
- RT_002: Encrypted key unreadable (wrong ENCRYPTION_KEY)
- RT_003: Framework context injection failure
- RT_004: FTS5 query before initialization complete
- RT_005: Apify 429 rate limit
- RT_006: ARG_MAX exceeded on Claude prompt

## Diagnostic Procedures (config/diagnostic-procedures.md)

Bash commands Claude Code can run directly:

```bash
# Layer 1: Environment
test -f .env.local && echo "EXISTS" || echo "MISSING"
grep -c "ANTHROPIC_API_KEY=" .env.local
grep "UNIPILE_DSN=" .env.local | grep -E "^UNIPILE_DSN=https://api[0-9]+\.unipile\.com:[0-9]+"

# Layer 2: Database
DB_PATH=$(grep DATABASE_URL .env.local | cut -d= -f2 | sed 's/file://')
test -f "$DB_PATH" && echo "DB EXISTS" || echo "DB MISSING"
sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
sqlite3 "$DB_PATH" "PRAGMA journal_mode;"
sqlite3 "$DB_PATH" "PRAGMA foreign_keys;"

# Layer 3: Configuration
test -f gtm-os.yaml && echo "FRAMEWORK EXISTS" || echo "FRAMEWORK MISSING"
node -e "require('js-yaml').load(require('fs').readFileSync('gtm-os.yaml','utf8'))" 2>&1
test -f ~/.gtm-os/config.yaml && echo "CONFIG EXISTS" || echo "CONFIG MISSING"

# Layer 4: Provider connectivity (example: Unipile)
curl -s -o /dev/null -w "%{http_code}" -H "X-API-KEY: $UNIPILE_API_KEY" "$UNIPILE_DSN/api/v1/accounts"

# Layer 5: Rate limits
sqlite3 "$DB_PATH" "SELECT * FROM rate_limit_buckets WHERE tokens_remaining = 0;"
```

## Verification

After implementation, test these scenarios:

1. **Missing .env.local** — Delete it, run any command, verify debugger catches at Layer 1
2. **Missing ANTHROPIC_API_KEY** — Remove from .env.local, run `pnpm cli -- setup`
3. **Invalid UNIPILE_DSN** — Set to `http://wrong`, run a LinkedIn command
4. **Missing DB tables** — Delete the .db file, run any command
5. **Invalid gtm-os.yaml** — Add a syntax error, run `pnpm cli -- onboard`
6. **Expired API key** — Use a fake Firecrawl key, run a scrape command
7. **Unresolved error** — Trigger a novel error, verify diagnostic report generation

Each test should confirm: (a) correct layer identified, (b) clear root cause explanation, (c) fix offered with approval gate, (d) fix works when approved.
