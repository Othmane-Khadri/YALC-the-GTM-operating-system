---
name: debugger
description: "Activate when any GTM-OS CLI command fails with an error. Also triggers on: 'debug', 'fix', 'not working', 'broken', 'troubleshoot', 'help me fix', 'what went wrong', 'why is this failing', or any variant indicating something is broken."
version: 1.0.0
---

# GTM-OS Debugger

Systematic diagnostic skill that activates when any GTM-OS command fails. Runs a 5-layer funnel from cheapest checks (file reads) to most expensive (live API calls), identifies the root cause, and offers auto-fixes with user approval.

## When This Skill Applies

- Any `pnpm cli --` command outputs an error or stack trace
- User says "debug" / "fix" / "not working" / "broken" / "troubleshoot"
- User says "help me fix [error]" / "what went wrong" / "why is this failing"
- User pastes an error message or stack trace from GTM-OS

## What This Skill Does NOT Do

- Fix bugs in user's custom code outside GTM-OS
- Debug network/firewall issues beyond basic connectivity checks
- Modify GTM-OS source code (only configuration, env vars, and database state)

## CRITICAL RULES

1. **Never skip layers.** Always start at Layer 1 even if you think you know the issue. Cheap checks catch 80% of problems.
2. **Never auto-fix without approval.** Always show the proposed change and ask before applying.
3. **Never expose secrets.** When reading `.env.local` or `api_connections`, mask all API keys (e.g., `sk-...redacted`).
4. **Short-circuit on first finding.** When a layer finds the root cause, stop and offer the fix. Don't keep checking.
5. **Re-run the original command after fixing.** The debug session isn't done until the command succeeds.

---

## Base Context: GTM-OS Architecture

GTM-OS is a CLI-first TypeScript system for AI-native go-to-market automation.

**Entry point:** `src/cli/index.ts` via `npx tsx`
**Env loading:** `.env.local` via `loadEnv()` at CLI startup
**Config files:** `~/.gtm-os/config.yaml` (user prefs) + `gtm-os.yaml` (GTM framework)
**Database:** SQLite via `@libsql/client` + Drizzle ORM. Default path: `file:./gtm-os.db`

### Three-Layer Architecture

| Layer | Location | Purpose |
|-------|----------|---------|
| Service | `src/lib/services/` | Singleton SDK wrappers (Unipile, Firecrawl, Notion). Lazy-init from env vars. |
| Provider | `src/lib/providers/builtin/` | `StepExecutor` implementations. Registry dispatches by capability. |
| Skill | `src/lib/skills/` | User-facing composable operations. |

### Provider Dependency Matrix

| Provider | Required Env Vars | Health Check | Common Failure |
|----------|------------------|--------------|----------------|
| Qualify | `ANTHROPIC_API_KEY` | Key format check | Missing or invalid key |
| Firecrawl | `FIRECRAWL_API_KEY` | 5s timeout scrape test | Expired key, timeout |
| Unipile | `UNIPILE_API_KEY` + `UNIPILE_DSN` | `getAccounts()` | Missing DSN, no LinkedIn account |
| Notion | `NOTION_API_KEY` | Light `search()` | Insufficient scopes |
| Crustdata | `CRUSTDATA_API_KEY` | Key format check | Credits exhausted |
| FullEnrich | `FULLENRICH_API_KEY` | Key format check | Invalid key format |
| Instantly | `INSTANTLY_API_KEY` | — | Invalid account |

### Critical Files Map

| Issue Domain | Files to Check |
|-------------|----------------|
| Environment | `.env.local`, `.env.example` |
| Database | `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `drizzle.config.ts` |
| Providers | `src/lib/services/{name}.ts`, `src/lib/providers/builtin/{name}-provider.ts` |
| Framework | `gtm-os.yaml`, `src/lib/framework/context.ts` |
| Config | `~/.gtm-os/config.yaml`, `src/lib/config/loader.ts` |
| Encryption | `src/lib/crypto.ts` |
| Rate limits | `src/lib/rate-limiter/index.ts` |
| CLI entry | `src/cli/index.ts` |

---

## Diagnostic Workflow

### Step 0: Capture Error Context

Before starting the funnel, capture:
1. The exact error message and stack trace
2. Which CLI command was run (e.g., `campaign:track`, `leads:qualify`)
3. Which provider is involved (extract from error message or command)

Store this context — you'll reference it throughout the funnel.

### Step 1: Layer 1 — Environment Validation (FREE)

Check `.env.local` existence and content. No API calls needed.

```bash
# Check .env.local exists
test -f .env.local && echo "OK: .env.local exists" || echo "FAIL: .env.local missing"
```

```bash
# Check required vars are set (mask values)
for var in ANTHROPIC_API_KEY DATABASE_URL ENCRYPTION_KEY; do
  if grep -q "^${var}=" .env.local 2>/dev/null; then
    echo "OK: $var is set"
  else
    echo "FAIL: $var is missing"
  fi
done
```

```bash
# Check provider-specific vars for the failing provider
# (run only the relevant check based on Step 0 context)

# Unipile check:
grep -q "^UNIPILE_API_KEY=" .env.local && echo "OK: UNIPILE_API_KEY set" || echo "FAIL: UNIPILE_API_KEY missing"
grep -q "^UNIPILE_DSN=" .env.local && echo "OK: UNIPILE_DSN set" || echo "FAIL: UNIPILE_DSN missing"

# Validate UNIPILE_DSN format (must be https://api{N}.unipile.com:{PORT})
grep "^UNIPILE_DSN=" .env.local | grep -qE "^UNIPILE_DSN=https://api[0-9]+\.unipile\.com:[0-9]+" && echo "OK: DSN format valid" || echo "FAIL: DSN format invalid"
```

```bash
# Check for common env var mistakes
# Trailing whitespace:
grep -n ' $' .env.local && echo "WARNING: Trailing whitespace found" || echo "OK: No trailing whitespace"
# Quoted values (should NOT be quoted):
grep -nE '^[A-Z_]+=".+"' .env.local && echo "WARNING: Quoted values found — remove quotes" || echo "OK: No quoted values"
```

**If any FAIL found:** Stop here. Explain the issue and offer to fix it.

**Auto-fix actions:**
- Missing `.env.local` → "I'll copy `.env.example` to `.env.local`. You'll need to fill in your API keys."
- Missing env var → "I'll add `{VAR}=` to your `.env.local`. Please paste your key value."
- Invalid DSN format → Show the correct format: `UNIPILE_DSN=https://api{N}.unipile.com:{PORT}`
- Quoted values → "I'll remove the quotes around the value."
- Trailing whitespace → "I'll trim the whitespace."

### Step 2: Layer 2 — Database Validation (FREE)

Check database file and schema state. Local queries only.

```bash
# Extract DB path from .env.local (default: ./gtm-os.db)
DB_URL=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2-)
DB_PATH="${DB_URL:-file:./gtm-os.db}"
DB_PATH="${DB_PATH#file:}"
echo "Database path: $DB_PATH"
test -f "$DB_PATH" && echo "OK: Database file exists" || echo "FAIL: Database file missing"
```

```bash
# Check core tables exist (need at least these)
sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" 2>&1
```

Expected tables (minimum): `conversations`, `messages`, `workflows`, `workflow_steps`, `result_sets`, `result_rows`, `knowledge_items`, `api_connections`, `frameworks`, `rate_limit_buckets`, `campaigns`, `campaign_leads`, `campaign_variants`, `campaign_messages`

```bash
# Check FTS5 virtual table
sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts';" 2>&1
```

```bash
# Check pragmas
sqlite3 "$DB_PATH" "PRAGMA journal_mode;" 2>&1
sqlite3 "$DB_PATH" "PRAGMA foreign_keys;" 2>&1
```

**If any FAIL found:** Stop here.

**Auto-fix actions:**
- Database file missing → "I'll run `pnpm db:push` to create the database and tables. Approve?"
- Missing tables → "Tables are missing. I'll run `pnpm db:push` to apply the schema. Approve?"
- FTS5 missing → "The full-text search index is missing. This usually self-heals on next startup. Try re-running your command."
- WAL mode off → "I'll enable WAL mode: `sqlite3 gtm-os.db 'PRAGMA journal_mode=WAL;'`. Approve?"

### Step 3: Layer 3 — Configuration Validation (FREE)

Check YAML config files exist and parse correctly.

```bash
# Check gtm-os.yaml
test -f gtm-os.yaml && echo "OK: gtm-os.yaml exists" || echo "FAIL: gtm-os.yaml missing"
```

```bash
# Validate YAML syntax
node -e "
try {
  require('js-yaml').load(require('fs').readFileSync('gtm-os.yaml','utf8'));
  console.log('OK: Valid YAML');
} catch(e) {
  console.log('FAIL: Invalid YAML -', e.message);
}
" 2>&1
```

```bash
# Check onboarding status
node -e "
const y = require('js-yaml').load(require('fs').readFileSync('gtm-os.yaml','utf8'));
console.log('onboarding_complete:', y.onboarding_complete || false);
" 2>&1
```

```bash
# Check user config
test -f ~/.gtm-os/config.yaml && echo "OK: User config exists" || echo "FAIL: User config missing at ~/.gtm-os/config.yaml"
```

**Auto-fix actions:**
- Missing `gtm-os.yaml` → "Run `yalc-gtm onboard` to create your GTM framework. This asks 5 questions about your business."
- Invalid YAML → Show the syntax error location and offer to fix it
- `onboarding_complete: false` → "Run `yalc-gtm onboard` to complete setup."
- Missing user config → "I'll create `~/.gtm-os/config.yaml` with defaults. Approve?"

### Step 4: Layer 4 — Provider Connectivity (1 API call)

Only test the provider involved in the error. Never test all providers.

**Identify the provider** from the error message or command:
- `campaign:track`, `leads:scrape-post`, `linkedin:*` → Unipile
- `search_web_*`, web scraping errors → Firecrawl
- `export`, `notion:*`, Notion errors → Notion
- `qualify`, Claude/AI errors → Anthropic
- `enrich`, email errors → Crustdata / FullEnrich

**Provider-specific health checks:**

```bash
# Unipile: Check accounts exist
source .env.local 2>/dev/null
curl -s -w "\nHTTP_STATUS:%{http_code}" -H "X-API-KEY: $UNIPILE_API_KEY" "$UNIPILE_DSN/api/v1/accounts" 2>&1 | tail -5
```

```bash
# Firecrawl: Lightweight check (don't scrape, just verify auth)
source .env.local 2>/dev/null
curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $FIRECRAWL_API_KEY" "https://api.firecrawl.dev/v1/scrape" -X POST -H "Content-Type: application/json" -d '{"url":"https://example.com","formats":["markdown"],"timeout":5000}' 2>&1 | tail -5
```

```bash
# Notion: Light search
source .env.local 2>/dev/null
curl -s -w "\nHTTP_STATUS:%{http_code}" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2022-06-28" "https://api.notion.com/v1/search" -X POST -H "Content-Type: application/json" -d '{"page_size":1}' 2>&1 | tail -5
```

**Interpret results:**
- HTTP 200 → Provider is working. Issue is elsewhere (proceed to Layer 5).
- HTTP 401/403 → Authentication failure. Key is invalid or expired.
- HTTP 429 → Rate limited. Wait and retry.
- Connection refused / timeout → Network issue or DSN wrong.
- HTTP 404 → Endpoint changed or DSN format wrong.

**Auto-fix actions:**
- Auth failure → "Your API key for {provider} is invalid or expired. Get a new one from {provider dashboard URL} and update .env.local."
- Rate limited → "You've hit the rate limit. Wait 60 seconds and try again."
- Unipile no accounts → "No LinkedIn account is connected in Unipile. Go to your Unipile dashboard to connect one."
- DSN connection failure → "The Unipile DSN is unreachable. Check if it matches the format `https://api{N}.unipile.com:{PORT}` — the DSN can rotate."

### Step 5: Layer 5 — Deep Diagnosis (varies)

If Layers 1-4 all pass, the issue is in application logic. Analyze the stack trace.

1. **Parse the stack trace** — identify the failing file and function
2. **Read the failing source file** — understand what it's trying to do
3. **Check for known runtime errors** — reference `config/error-catalog.md`
4. **Check rate limit state:**
```bash
DB_PATH=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2- | sed 's/^file://')
DB_PATH="${DB_PATH:-./gtm-os.db}"
sqlite3 "$DB_PATH" "SELECT provider, tokens_remaining, last_refill_at FROM rate_limit_buckets;" 2>&1
```

5. **Check encryption state:**
```bash
sqlite3 "$DB_PATH" "SELECT provider, status, substr(encrypted_key, 1, 20) || '...' as key_preview FROM api_connections;" 2>&1
```

6. **Check for concurrent access:**
```bash
# Check if another process has the DB locked
lsof "$DB_PATH" 2>/dev/null | head -5
```

**Auto-fix actions vary by finding.** Always explain what you found and propose a specific fix.

### Step 6: Unresolved — Generate Diagnostic Report

If all layers pass but the error persists:

1. Collect a diagnostic summary:
   - OS + Node.js version
   - GTM-OS version (from package.json)
   - Env vars present (names only, never values)
   - Database table count
   - Provider availability status
   - The original error + stack trace

2. Save to `./debug-report-{YYYYMMDD-HHmmss}.md`

3. Tell the user:
> "I've exhausted the standard diagnostic checks and couldn't identify the root cause. I've saved a diagnostic report to `debug-report-{timestamp}.md`. You can share this when filing a GitHub issue — it contains no secrets."

---

## After Fixing

Once a fix is applied:
1. Re-run the exact command that originally failed
2. If it succeeds → "Fixed! The command ran successfully."
3. If it fails with a NEW error → restart the funnel from Layer 1 with the new error
4. If it fails with the SAME error → escalate to the next layer

---

## Provider Dashboard URLs (for guiding users to regenerate keys)

| Provider | Dashboard |
|----------|-----------|
| Anthropic | https://console.anthropic.com/settings/keys |
| Unipile | Your Unipile admin panel (URL varies by account) |
| Firecrawl | https://firecrawl.dev/app/api-keys |
| Notion | https://www.notion.so/my-integrations |
| Crustdata | https://crustdata.com/app/api-keys |
| FullEnrich | https://app.fullenrich.com/api-keys |
| Instantly | https://app.instantly.ai/app/settings/api |
