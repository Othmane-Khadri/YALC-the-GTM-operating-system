# GTM-OS Diagnostic Procedures

Bash commands for each diagnostic layer. Run these in order. Stop at the first layer that finds an issue.

---

## Layer 1: Environment Validation

### 1.1 Check .env.local exists
```bash
test -f .env.local && echo "PASS: .env.local exists" || echo "FAIL: .env.local missing — copy .env.example to .env.local"
```

### 1.2 Check required vars
```bash
for var in ANTHROPIC_API_KEY DATABASE_URL ENCRYPTION_KEY; do
  if grep -q "^${var}=" .env.local 2>/dev/null; then
    echo "PASS: $var is set"
  else
    echo "FAIL: $var is missing from .env.local"
  fi
done
```

### 1.3 Check provider-specific vars
```bash
# Unipile (both required together)
UKEY=$(grep -c "^UNIPILE_API_KEY=" .env.local 2>/dev/null)
UDSN=$(grep -c "^UNIPILE_DSN=" .env.local 2>/dev/null)
if [ "$UKEY" -gt 0 ] && [ "$UDSN" -gt 0 ]; then
  echo "PASS: Unipile vars set"
elif [ "$UKEY" -gt 0 ] && [ "$UDSN" -eq 0 ]; then
  echo "FAIL: UNIPILE_API_KEY set but UNIPILE_DSN missing — both are required"
elif [ "$UKEY" -eq 0 ] && [ "$UDSN" -gt 0 ]; then
  echo "FAIL: UNIPILE_DSN set but UNIPILE_API_KEY missing — both are required"
else
  echo "INFO: Unipile not configured (optional)"
fi

# Other providers (single key each)
for var in FIRECRAWL_API_KEY NOTION_API_KEY CRUSTDATA_API_KEY FULLENRICH_API_KEY INSTANTLY_API_KEY; do
  if grep -q "^${var}=" .env.local 2>/dev/null; then
    echo "PASS: $var is set"
  else
    echo "INFO: $var not set (optional)"
  fi
done
```

### 1.4 Validate UNIPILE_DSN format
```bash
DSN=$(grep "^UNIPILE_DSN=" .env.local 2>/dev/null | cut -d= -f2-)
if [ -z "$DSN" ]; then
  echo "SKIP: UNIPILE_DSN not set"
elif echo "$DSN" | grep -qE "^https://api[0-9]+\.unipile\.com:[0-9]+$"; then
  echo "PASS: UNIPILE_DSN format valid"
else
  echo "FAIL: UNIPILE_DSN format invalid. Expected: https://api{N}.unipile.com:{PORT} — Got: ${DSN:0:30}..."
fi
```

### 1.5 Check for common env var mistakes
```bash
# Trailing whitespace
if grep -nP ' +$' .env.local 2>/dev/null | head -3; then
  echo "WARN: Trailing whitespace found on above lines — this can cause auth failures"
else
  echo "PASS: No trailing whitespace"
fi

# Quoted values
if grep -nE '^[A-Z_]+=".+"' .env.local 2>/dev/null | head -3; then
  echo "WARN: Quoted values found — remove the double quotes"
else
  echo "PASS: No quoted values"
fi

# Empty values
if grep -nE '^[A-Z_]+=$' .env.local 2>/dev/null | head -3; then
  echo "WARN: Empty values found on above lines"
else
  echo "PASS: No empty values"
fi
```

---

## Layer 2: Database Validation

### 2.1 Resolve DB path
```bash
DB_URL=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2-)
DB_PATH="${DB_URL:-file:./gtm-os.db}"
DB_PATH="${DB_PATH#file:}"
DB_PATH="${DB_PATH#./}"
DB_PATH="${DB_PATH:-.gtm-os.db}"
# Handle relative paths
if [[ "$DB_PATH" != /* ]]; then
  DB_PATH="$(pwd)/$DB_PATH"
fi
echo "Database path: $DB_PATH"
test -f "$DB_PATH" && echo "PASS: Database file exists" || echo "FAIL: Database file missing at $DB_PATH"
```

### 2.2 Check tables exist
```bash
TABLES=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" 2>&1)
if [ $? -ne 0 ]; then
  echo "FAIL: Cannot query database — $TABLES"
else
  echo "Tables found:"
  echo "$TABLES"
  # Check for critical tables
  for t in conversations messages workflows workflow_steps result_sets result_rows api_connections frameworks campaigns; do
    echo "$TABLES" | grep -q "^${t}$" && echo "  PASS: $t" || echo "  FAIL: $t missing"
  done
fi
```

### 2.3 Check FTS5
```bash
FTS=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE name='knowledge_fts';" 2>&1)
if [ -n "$FTS" ]; then
  echo "PASS: FTS5 table exists"
else
  echo "WARN: FTS5 table missing — knowledge search won't work. Will auto-create on next startup."
fi
```

### 2.4 Check pragmas
```bash
WAL=$(sqlite3 "$DB_PATH" "PRAGMA journal_mode;" 2>&1)
FK=$(sqlite3 "$DB_PATH" "PRAGMA foreign_keys;" 2>&1)
echo "Journal mode: $WAL $([ "$WAL" = "wal" ] && echo '(PASS)' || echo '(WARN: should be wal)')"
echo "Foreign keys: $FK $([ "$FK" = "1" ] && echo '(PASS)' || echo '(WARN: should be 1)')"
```

### 2.5 Check for locks
```bash
LOCKS=$(lsof "$DB_PATH" 2>/dev/null)
if [ -n "$LOCKS" ]; then
  echo "WARN: Database file is open by:"
  echo "$LOCKS" | head -5
else
  echo "PASS: No processes holding the database"
fi
```

---

## Layer 3: Configuration Validation

### 3.1 Check gtm-os.yaml
```bash
test -f gtm-os.yaml && echo "PASS: gtm-os.yaml exists" || echo "FAIL: gtm-os.yaml missing — run: yalc-gtm onboard"
```

### 3.2 Validate YAML syntax
```bash
node -e "
try {
  const y = require('js-yaml').load(require('fs').readFileSync('gtm-os.yaml','utf8'));
  console.log('PASS: Valid YAML');
  console.log('  onboarding_complete:', y.onboarding_complete || false);
  console.log('  company.name:', y.company?.name || '(not set)');
  console.log('  segments:', (y.segments || []).length, 'defined');
} catch(e) {
  console.log('FAIL: Invalid YAML');
  console.log('  Error:', e.message);
  if (e.mark) console.log('  Line:', e.mark.line + 1, 'Column:', e.mark.column + 1);
}
" 2>&1
```

### 3.3 Check user config
```bash
if test -f ~/.gtm-os/config.yaml; then
  echo "PASS: User config exists at ~/.gtm-os/config.yaml"
  node -e "
  try {
    require('js-yaml').load(require('fs').readFileSync(require('os').homedir()+'/.gtm-os/config.yaml','utf8'));
    console.log('PASS: Valid YAML');
  } catch(e) {
    console.log('FAIL: Invalid YAML -', e.message);
  }
  " 2>&1
else
  echo "WARN: No user config at ~/.gtm-os/config.yaml — using defaults"
fi
```

---

## Layer 4: Provider Connectivity

### 4.1 Unipile health check
```bash
source .env.local 2>/dev/null
RESP=$(curl -s -w "\n%{http_code}" -H "X-API-KEY: $UNIPILE_API_KEY" "$UNIPILE_DSN/api/v1/accounts" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | head -n -1)
echo "Unipile status: HTTP $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  ACCT_COUNT=$(echo "$BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('items',d if isinstance(d,list) else [])))" 2>/dev/null || echo "?")
  echo "PASS: Unipile reachable — $ACCT_COUNT account(s) connected"
  [ "$ACCT_COUNT" = "0" ] && echo "WARN: No LinkedIn accounts connected — add one in your Unipile dashboard"
elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
  echo "FAIL: Authentication failed — API key is invalid or expired"
elif [ "$HTTP_CODE" = "000" ]; then
  echo "FAIL: Connection refused — DSN may have rotated. Check your Unipile dashboard for the current DSN."
else
  echo "FAIL: Unexpected response — HTTP $HTTP_CODE"
fi
```

### 4.2 Firecrawl health check
```bash
source .env.local 2>/dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $FIRECRAWL_API_KEY" "https://api.firecrawl.dev/v1/scrape" -X POST -H "Content-Type: application/json" -d '{"url":"https://example.com","formats":["markdown"],"timeout":5000}' --max-time 10 2>&1)
echo "Firecrawl status: HTTP $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  echo "PASS: Firecrawl working"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "FAIL: API key invalid — get a new one at https://firecrawl.dev/app/api-keys"
elif [ "$HTTP_CODE" = "402" ]; then
  echo "FAIL: Firecrawl credits exhausted — upgrade plan or wait for reset"
elif [ "$HTTP_CODE" = "429" ]; then
  echo "FAIL: Rate limited — wait and retry"
else
  echo "FAIL: Unexpected response — HTTP $HTTP_CODE"
fi
```

### 4.3 Notion health check
```bash
source .env.local 2>/dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $NOTION_API_KEY" -H "Notion-Version: 2022-06-28" "https://api.notion.com/v1/search" -X POST -H "Content-Type: application/json" -d '{"page_size":1}' --max-time 10 2>&1)
echo "Notion status: HTTP $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  echo "PASS: Notion working"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "FAIL: API token invalid — regenerate at https://www.notion.so/my-integrations"
elif [ "$HTTP_CODE" = "403" ]; then
  echo "FAIL: Insufficient permissions — share your databases with the GTM-OS integration"
else
  echo "FAIL: Unexpected response — HTTP $HTTP_CODE"
fi
```

### 4.4 Anthropic health check
```bash
source .env.local 2>/dev/null
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: $ANTHROPIC_API_KEY" -H "anthropic-version: 2023-06-01" "https://api.anthropic.com/v1/messages" -X POST -H "Content-Type: application/json" -d '{"model":"claude-sonnet-4-6","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}' --max-time 10 2>&1)
echo "Anthropic status: HTTP $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
  echo "PASS: Anthropic API working"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "FAIL: API key invalid — get a new one at https://console.anthropic.com/settings/keys"
elif [ "$HTTP_CODE" = "429" ]; then
  echo "FAIL: Rate limited — wait and retry"
elif [ "$HTTP_CODE" = "529" ]; then
  echo "FAIL: Anthropic API overloaded — wait a minute and retry"
else
  echo "FAIL: Unexpected response — HTTP $HTTP_CODE"
fi
```

---

## Layer 5: Deep Diagnosis

### 5.1 Rate limit bucket state
```bash
DB_PATH=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2- | sed 's/^file://' | sed 's/^\.\///')
DB_PATH="${DB_PATH:-gtm-os.db}"
echo "Rate limit buckets:"
sqlite3 "$DB_PATH" ".mode column" ".headers on" "SELECT provider, tokens_remaining, max_tokens, last_refill_at FROM rate_limit_buckets;" 2>&1
EXHAUSTED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM rate_limit_buckets WHERE tokens_remaining <= 0;" 2>&1)
echo "Exhausted buckets: $EXHAUSTED"
```

### 5.2 API connections state
```bash
DB_PATH=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2- | sed 's/^file://' | sed 's/^\.\///')
DB_PATH="${DB_PATH:-gtm-os.db}"
echo "Stored API connections (keys masked):"
sqlite3 "$DB_PATH" "SELECT provider, status, substr(encrypted_key, 1, 15) || '...[masked]' as key_preview FROM api_connections;" 2>&1
```

### 5.3 System info (for diagnostic report)
```bash
echo "=== GTM-OS Diagnostic Report ==="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "OS: $(uname -s) $(uname -r)"
echo "Node: $(node -v 2>&1)"
echo "pnpm: $(pnpm -v 2>&1)"
echo "GTM-OS version: $(node -e "console.log(require('./package.json').version)" 2>&1)"
echo "Env vars present:"
for var in ANTHROPIC_API_KEY DATABASE_URL ENCRYPTION_KEY UNIPILE_API_KEY UNIPILE_DSN FIRECRAWL_API_KEY NOTION_API_KEY CRUSTDATA_API_KEY FULLENRICH_API_KEY INSTANTLY_API_KEY; do
  grep -q "^${var}=" .env.local 2>/dev/null && echo "  $var: YES" || echo "  $var: NO"
done
DB_PATH=$(grep "^DATABASE_URL=" .env.local 2>/dev/null | cut -d= -f2- | sed 's/^file://' | sed 's/^\.\///')
DB_PATH="${DB_PATH:-gtm-os.db}"
echo "DB tables: $(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>&1)"
echo "Framework: $(test -f gtm-os.yaml && echo 'present' || echo 'missing')"
echo "User config: $(test -f ~/.gtm-os/config.yaml && echo 'present' || echo 'missing')"
```
