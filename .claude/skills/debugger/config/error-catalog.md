# GTM-OS Error Catalog

Known errors organized by diagnostic layer. Each entry maps an error pattern to its root cause and fix.

---

## Layer 1 — Environment Errors

### ENV_001: Missing ANTHROPIC_API_KEY

**Error patterns:**
- `ANTHROPIC_API_KEY must be set`
- `Missing API key for Claude`
- `AnthropicError: 401`

**Root cause:** User didn't add their Anthropic API key to `.env.local`.
**Diagnostic:** `grep -q "^ANTHROPIC_API_KEY=" .env.local`
**Auto-fix:**
1. Ask user for their API key (get it from https://console.anthropic.com/settings/keys)
2. Append `ANTHROPIC_API_KEY={key}` to `.env.local`
**Approval level:** Standard
**Severity:** Blocking — no AI features work

---

### ENV_002: Missing UNIPILE_DSN (key present, DSN missing)

**Error patterns:**
- `UNIPILE_DSN and UNIPILE_API_KEY must be set`
- `Cannot read properties of undefined (reading 'replace')` (from URL construction)

**Root cause:** User set `UNIPILE_API_KEY` but forgot `UNIPILE_DSN`. Both are required.
**Diagnostic:** `grep -q "^UNIPILE_DSN=" .env.local`
**Auto-fix:**
1. Tell user: "Unipile requires both an API key AND a DSN (base URL). Find your DSN in the Unipile dashboard."
2. Ask for the DSN value
3. Append `UNIPILE_DSN={value}` to `.env.local`
**Approval level:** Standard
**Severity:** Blocking — no LinkedIn operations

---

### ENV_003: Invalid UNIPILE_DSN format

**Error patterns:**
- `ECONNREFUSED`
- `fetch failed` with Unipile URL
- `getaddrinfo ENOTFOUND`

**Root cause:** DSN doesn't match the required format `https://api{N}.unipile.com:{PORT}`. Common mistakes: missing port, `http://` instead of `https://`, trailing slash.
**Diagnostic:** `grep "^UNIPILE_DSN=" .env.local | grep -qE "^UNIPILE_DSN=https://api[0-9]+\.unipile\.com:[0-9]+$"`
**Auto-fix:**
1. Show current value (masked) and expected format
2. Ask user to get the correct DSN from their Unipile dashboard
3. Update the value in `.env.local`
**Approval level:** Standard
**Severity:** Blocking — LinkedIn operations fail

---

### ENV_004: Missing ENCRYPTION_KEY

**Error patterns:**
- `ENCRYPTION_KEY must be set`
- `Cannot encrypt: missing encryption key`

**Root cause:** The encryption key for API key storage isn't set.
**Diagnostic:** `grep -q "^ENCRYPTION_KEY=" .env.local`
**Auto-fix:**
1. Generate a new key: `openssl rand -hex 32`
2. Append `ENCRYPTION_KEY={generated}` to `.env.local`
3. Warn: "If you already had encrypted API keys stored, they'll need to be re-added."
**Approval level:** Standard
**Severity:** Blocking — can't store or retrieve API connections

---

### ENV_005: Missing .env.local file

**Error patterns:**
- Multiple `must be set` errors on first run
- `ENOENT: no such file or directory, open '.env.local'`

**Root cause:** User didn't create `.env.local` from the example file.
**Diagnostic:** `test -f .env.local`
**Auto-fix:**
1. Copy `.env.example` to `.env.local`
2. Tell user: "I've created `.env.local` from the example. You need to fill in your API keys."
**Approval level:** Standard
**Severity:** Blocking — nothing works

---

### ENV_006: DATABASE_URL points to non-writable path

**Error patterns:**
- `SQLITE_CANTOPEN`
- `unable to open database file`

**Root cause:** The path in `DATABASE_URL` doesn't exist or isn't writable.
**Diagnostic:** Check file path permissions
**Auto-fix:**
1. If path doesn't exist, offer to create parent directories
2. If permissions issue, suggest `chmod` or changing the path
**Approval level:** Standard
**Severity:** Blocking — no database access

---

### ENV_007: Turso URL without auth token

**Error patterns:**
- `LibsqlError: HRANA_WEBSOCKET_ERROR`
- `Unauthorized` from Turso

**Root cause:** `DATABASE_URL` points to a Turso remote URL but `TURSO_AUTH_TOKEN` is missing.
**Diagnostic:** `grep "^DATABASE_URL=" .env.local | grep -q "turso.io"` + `grep -q "^TURSO_AUTH_TOKEN=" .env.local`
**Auto-fix:**
1. Ask user for their Turso auth token
2. Append `TURSO_AUTH_TOKEN={token}` to `.env.local`
3. Alternative: suggest switching to local SQLite with `DATABASE_URL=file:./gtm-os.db`
**Approval level:** Standard
**Severity:** Blocking — no database access

---

## Layer 2 — Database Errors

### DB_001: Database file doesn't exist

**Error patterns:**
- `SQLITE_CANTOPEN`
- No file at expected DB path

**Root cause:** Database hasn't been initialized yet. User needs to run migrations.
**Diagnostic:** `test -f ./gtm-os.db` (or the path from DATABASE_URL)
**Auto-fix:**
1. Run `pnpm db:push` to create the database and apply schema
**Approval level:** Standard
**Severity:** Blocking

---

### DB_002: Missing core tables

**Error patterns:**
- `SQLITE_ERROR: no such table: {table_name}`
- `relation "{table_name}" does not exist`

**Root cause:** Schema migration hasn't been applied or was partially applied.
**Diagnostic:** `sqlite3 gtm-os.db "SELECT name FROM sqlite_master WHERE type='table';"`
**Auto-fix:**
1. Run `pnpm db:push` to apply full schema
**Approval level:** Standard
**Severity:** Blocking

---

### DB_003: FTS5 virtual table missing

**Error patterns:**
- `no such table: knowledge_fts`
- Knowledge search returns empty when items exist

**Root cause:** FTS5 initialization is fire-and-forget. It runs asynchronously on module load and can fail silently.
**Diagnostic:** `sqlite3 gtm-os.db "SELECT name FROM sqlite_master WHERE name='knowledge_fts';"`
**Auto-fix:**
1. The FTS5 table auto-creates on next application startup. Re-run the command.
2. If persistent, manually create: `sqlite3 gtm-os.db "CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(item_id, title, extracted_text);"`
**Approval level:** Standard
**Severity:** Degraded — knowledge search broken, other features work

---

### DB_004: WAL mode not enabled

**Error patterns:**
- `SQLITE_BUSY` on concurrent operations
- Database locked during reads

**Root cause:** WAL (Write-Ahead Logging) mode isn't enabled, causing lock contention.
**Diagnostic:** `sqlite3 gtm-os.db "PRAGMA journal_mode;"`
**Auto-fix:**
1. Enable WAL: `sqlite3 gtm-os.db "PRAGMA journal_mode=WAL;"`
**Approval level:** Standard
**Severity:** Degraded — intermittent failures under concurrency

---

### DB_005: Foreign key constraint violation

**Error patterns:**
- `SQLITE_CONSTRAINT: FOREIGN KEY constraint failed`

**Root cause:** Attempting to insert a row referencing a non-existent parent row (e.g., workflow_step for deleted workflow).
**Diagnostic:** Identify which table and which foreign key from the error context.
**Auto-fix:**
1. This is usually a bug in the application logic or stale data. Check if the parent record exists.
2. If caused by manually deleted data, suggest re-running the parent operation first.
**Approval level:** Standard
**Severity:** Blocking for the specific operation

---

### DB_006: Database locked (concurrent access)

**Error patterns:**
- `SQLITE_BUSY`
- `database is locked`

**Root cause:** Another GTM-OS process is holding a write lock. Common with multiple CLI instances or the server running simultaneously.
**Diagnostic:** `lsof gtm-os.db 2>/dev/null`
**Auto-fix:**
1. Show which processes hold the file open
2. Suggest: "Close other GTM-OS processes or wait for them to finish."
3. If no processes found, the lock may be stale: "Try `sqlite3 gtm-os.db 'PRAGMA journal_mode=WAL;'` to switch to WAL mode which allows concurrent reads."
**Approval level:** Standard
**Severity:** Blocking — operation can't proceed

---

## Layer 3 — Configuration Errors

### CFG_001: Missing gtm-os.yaml

**Error patterns:**
- `No framework found. Run onboard first.`
- `ENOENT: no such file or directory, open 'gtm-os.yaml'`

**Root cause:** User hasn't completed onboarding.
**Diagnostic:** `test -f gtm-os.yaml`
**Auto-fix:**
1. Run `yalc-gtm onboard` — this asks 5 questions and creates the file.
**Approval level:** Standard
**Severity:** Blocking — framework context injection fails

---

### CFG_002: Invalid YAML syntax

**Error patterns:**
- `YAMLException: bad indentation`
- `YAMLException: unexpected end of the stream`

**Root cause:** User manually edited `gtm-os.yaml` and introduced a syntax error.
**Diagnostic:** `node -e "require('js-yaml').load(require('fs').readFileSync('gtm-os.yaml','utf8'))"`
**Auto-fix:**
1. Parse the YAML error to identify the line number
2. Read the file, identify the syntax issue
3. Show the fix diff and apply with approval
**Approval level:** Standard
**Severity:** Blocking

---

### CFG_003: Onboarding incomplete

**Error patterns:**
- `onboarding_complete is false`
- Empty/default framework values causing poor qualification

**Root cause:** User started but didn't finish onboarding, or `onboarding_complete` flag wasn't set.
**Diagnostic:** Check `onboarding_complete` field in `gtm-os.yaml`
**Auto-fix:**
1. If the file has real company data → set `onboarding_complete: true`
2. If the file is mostly empty → run `yalc-gtm onboard`
**Approval level:** Standard
**Severity:** Degraded — system works but with poor context

---

### CFG_004: Missing user config

**Error patterns:**
- `Config file not found at ~/.gtm-os/config.yaml`

**Root cause:** First run or config was deleted.
**Diagnostic:** `test -f ~/.gtm-os/config.yaml`
**Auto-fix:**
1. Create `~/.gtm-os/config.yaml` with sensible defaults:
```yaml
notion:
  enabled: false
unipile:
  max_connections_per_day: 30
crustdata:
  max_results_per_query: 50
```
**Approval level:** Standard
**Severity:** Degraded — uses hardcoded defaults

---

### CFG_005: Invalid Notion DS ID format

**Error patterns:**
- `Invalid database ID`
- Notion API errors on export

**Root cause:** Notion data source ID in config isn't a valid 36-character UUID.
**Diagnostic:** Check UUID format in `~/.gtm-os/config.yaml`
**Auto-fix:**
1. Show the invalid ID
2. Tell user: "Notion database IDs are 36-character UUIDs. Get the correct ID from your Notion database URL."
**Approval level:** Standard
**Severity:** Blocking for Notion operations

---

### CFG_006: Missing HOME environment variable

**Error patterns:**
- `Cannot read properties of undefined` in config path expansion
- `TypeError: Cannot read property 'replace' of undefined`

**Root cause:** The `HOME` env var isn't set (rare, but happens in some Docker/CI environments). GTM-OS uses `process.env.HOME` for path expansion.
**Diagnostic:** `echo $HOME`
**Auto-fix:**
1. Set `HOME` in the current shell: `export HOME=$(eval echo ~)`
2. For persistence, add to shell profile
**Approval level:** Standard
**Severity:** Blocking

---

## Layer 4 — Provider Errors

### PRV_001: Unipile — No LinkedIn account connected

**Error patterns:**
- `No LinkedIn account connected in Unipile`
- `accounts` response returns empty array

**Root cause:** Unipile API is reachable but no LinkedIn account has been linked in the Unipile dashboard.
**Diagnostic:** `curl -s -H "X-API-KEY: $UNIPILE_API_KEY" "$UNIPILE_DSN/api/v1/accounts" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('items',d if isinstance(d,list) else [])),'accounts')"`
**Auto-fix:**
1. Guide user: "Go to your Unipile dashboard and connect your LinkedIn account."
**Approval level:** N/A (requires manual action in external dashboard)
**Severity:** Blocking for LinkedIn operations

---

### PRV_002: Unipile — DSN rotated

**Error patterns:**
- `account not found`
- `ECONNREFUSED` after DSN was previously working

**Root cause:** Unipile infrastructure rotates DSN endpoints. The stored DSN is stale.
**Diagnostic:** Previous working DSN now returns connection errors.
**Auto-fix:**
1. "Your Unipile DSN has rotated. Get the new DSN from your Unipile dashboard and update `.env.local`."
**Approval level:** Standard
**Severity:** Blocking for LinkedIn operations

---

### PRV_003: Firecrawl — API key expired or invalid

**Error patterns:**
- `401 Unauthorized` from Firecrawl
- `Invalid API key`

**Root cause:** Firecrawl API key is expired or was regenerated.
**Diagnostic:** Test the key with a lightweight API call.
**Auto-fix:**
1. "Get a new API key from https://firecrawl.dev/app/api-keys and update `FIRECRAWL_API_KEY` in `.env.local`."
**Approval level:** Standard
**Severity:** Blocking for web scraping/search

---

### PRV_004: Notion — Insufficient API token scopes

**Error patterns:**
- `Could not find database with ID`
- `Insufficient permissions for this resource`

**Root cause:** Notion integration token doesn't have access to the specified database. User needs to share the database with the integration.
**Diagnostic:** Notion search returns empty but API is reachable.
**Auto-fix:**
1. "Open the target Notion database → click '...' → 'Add connections' → select your GTM-OS integration."
**Approval level:** N/A (requires manual Notion UI action)
**Severity:** Blocking for Notion export

---

### PRV_005: Crustdata — Credits exhausted

**Error patterns:**
- Searches return 0 results when they shouldn't
- `credits_remaining: 0`

**Root cause:** Crustdata account has no remaining API credits.
**Diagnostic:** `curl -s -H "Authorization: Bearer $CRUSTDATA_API_KEY" "https://api.crustdata.com/v1/credits"`
**Auto-fix:**
1. "Your Crustdata credits are exhausted. Purchase more at https://crustdata.com/app/api-keys or switch to Firecrawl for web search."
**Approval level:** N/A (requires account action)
**Severity:** Degraded — Crustdata operations fail, other providers work

---

### PRV_006: Provider not found (typo in provider name)

**Error patterns:**
- `ProviderNotFoundError: Provider "{name}" not found`
- Includes Levenshtein suggestion in error message

**Root cause:** The workflow referenced a provider name that doesn't match any registered provider.
**Diagnostic:** The error message itself contains the suggestion.
**Auto-fix:**
1. "Did you mean `{suggestion}`? The registered providers are: mock, qualify, firecrawl, unipile, notion, crustdata, fullenrich, instantly."
**Approval level:** N/A (informational)
**Severity:** Blocking for the specific step

---

### PRV_007: Rate limit exceeded

**Error patterns:**
- `Rate limit exceeded for {provider}`
- `429 Too Many Requests`
- `tokens_remaining: 0` in rate_limit_buckets

**Root cause:** Provider rate limit bucket is empty. Limits: LinkedIn connect 30/day, LinkedIn DM 100/day, Instantly send 50/day.
**Diagnostic:** `sqlite3 gtm-os.db "SELECT * FROM rate_limit_buckets WHERE tokens_remaining <= 0;"`
**Auto-fix:**
1. Show when the bucket refills (based on `last_refill_at`)
2. "Rate limit resets daily. Wait until tomorrow or reduce your daily volume."
3. If bucket data looks wrong: "I can reset the rate limit bucket. This won't bypass the provider's actual rate limit. Approve?"
**Approval level:** Standard (for bucket reset)
**Severity:** Blocking until refill

---

## Layer 5 — Runtime Errors

### RT_001: Notion "Request body too large"

**Error patterns:**
- `body is too large`
- `Request body too large`
- Notion bulk insert fails

**Root cause:** Batch size exceeds 40 pages per `create-pages` call. The limit is 40, not 100.
**Diagnostic:** Check the batch size in the failing code path.
**Auto-fix:**
1. "The Notion batch size is too large. GTM-OS limits batches to 40 pages. If this is a custom operation, reduce your batch size."
**Approval level:** N/A (informational — requires code-level fix if in custom code)
**Severity:** Blocking for the specific export

---

### RT_002: Encrypted key unreadable

**Error patterns:**
- `Invalid encrypted format`
- `Decryption failed`
- `bad decrypt` from crypto module

**Root cause:** The `ENCRYPTION_KEY` in `.env.local` doesn't match the key used to encrypt stored API connections.
**Diagnostic:** `sqlite3 gtm-os.db "SELECT provider, substr(encrypted_key, 1, 30) FROM api_connections;"`
**Auto-fix:**
1. **Non-destructive option:** "If you have the original encryption key, restore it in `.env.local`."
2. **Destructive option (requires approval):** "I can clear all stored API connections and you'll re-enter them. This deletes encrypted keys from the database."
   - `sqlite3 gtm-os.db "DELETE FROM api_connections;"`
**Approval level:** Destructive for option 2
**Severity:** Blocking — stored keys can't be decrypted

---

### RT_003: Framework context injection failure

**Error patterns:**
- `Cannot read properties of undefined (reading 'company')`
- Framework fields are `undefined` in Claude prompts

**Root cause:** `gtm-os.yaml` exists but has an incomplete structure — missing required nested fields.
**Diagnostic:** Validate structure against expected schema.
**Auto-fix:**
1. Read current file, identify missing fields
2. Show diff with added default values
3. Apply with approval
**Approval level:** Standard
**Severity:** Degraded — AI operations produce poor results

---

### RT_004: FTS5 query before initialization

**Error patterns:**
- `no such table: knowledge_fts` (on knowledge search, not on startup)

**Root cause:** FTS5 initialization is asynchronous and fire-and-forget. A knowledge search ran before init completed.
**Diagnostic:** `sqlite3 gtm-os.db "SELECT name FROM sqlite_master WHERE name='knowledge_fts';"`
**Auto-fix:**
1. "This is a timing issue. Re-run the command — the FTS5 table should be initialized by now."
2. If persistent: manually create the virtual table.
**Approval level:** Standard
**Severity:** Degraded — knowledge search temporarily unavailable

---

### RT_005: Apify 429 rate limit

**Error patterns:**
- `429 Too Many Requests` from Apify
- `ActorRateLimitExceeded`

**Root cause:** Apify usage exceeded plan limits.
**Diagnostic:** Check `logs/apify_spend_{agent}.json` if it exists.
**Auto-fix:**
1. "Wait 60 seconds and retry."
2. "Check your Apify usage dashboard for remaining credits."
**Approval level:** N/A (informational)
**Severity:** Blocking for the specific scrape

---

### RT_006: ARG_MAX exceeded on Claude prompt

**Error patterns:**
- `Argument list too long`
- `E2BIG`
- Shell error when passing large prompts

**Root cause:** The assembled prompt (with framework context + intelligence + knowledge) exceeds the shell's argument length limit.
**Diagnostic:** Check if the command uses `claude -p "$(cat ...)"` pattern instead of piping.
**Auto-fix:**
1. "Use piped input instead: `cat prompt.txt | claude -p`"
2. "Or reduce the framework context size by trimming learnings in `gtm-os.yaml`."
**Approval level:** Standard
**Severity:** Blocking
