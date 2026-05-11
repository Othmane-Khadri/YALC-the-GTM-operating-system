# Example Output

Two scenarios — a clean run and a failure run with `/keys/connect/<provider>` hints surfaced.

## Scenario A — clean run

```
GTM-OS health check — 5 layers, 19 checks

Layer 1 — Environment
  PASS  ~/.gtm-os/.env
  PASS  ANTHROPIC_API_KEY
  PASS  ENCRYPTION_KEY
  PASS  Unipile credentials
  PASS  Firecrawl (FIRECRAWL_API_KEY)
  PASS  Notion (NOTION_API_KEY)
  PASS  Crustdata (CRUSTDATA_API_KEY)
  SKIP  FullEnrich (FULLENRICH_API_KEY) — not configured (optional)
  SKIP  Instantly (INSTANTLY_API_KEY) — not configured (optional)
  PASS  No quoted values
  PASS  No trailing whitespace

Layer 2 — Database
  PASS  Database file
  PASS  Core tables (9/9)
  PASS  FTS5 search index
  PASS  WAL mode
  PASS  Foreign keys

Layer 3 — Configuration
  PASS  GTM framework (~/.gtm-os/framework.yaml)
  PASS  Company: Earleads
  PASS  ICP segments: 3 defined
  PASS  User config (~/.gtm-os/config.yaml)
  PASS  Goals block
  PASS  Company context (~/.gtm-os/company_context.yaml)
  PASS  sources.linkedin_account_id

Layer 4 — Provider Connectivity
  PASS  Anthropic API
  PASS  Unipile (LinkedIn) — 1 account(s) connected
  PASS  Firecrawl
  PASS  Notion
  PASS  Crustdata

Layer 5 — Runtime State
  PASS  Rate limit buckets — all buckets have tokens
  PASS  Stored API connections: 5
  PASS  data/leads/
  PASS  data/intelligence/
  PASS  data/campaigns/
  PASS  data/content/

Summary: 30 passed, 0 failed, 0 warnings, 2 skipped.
GTM-OS is healthy. All systems operational.
```

## Scenario B — failures with connect URLs

```
GTM-OS health check — 5 layers, 19 checks

Layer 1 — Environment
  PASS  ~/.gtm-os/.env
  PASS  ANTHROPIC_API_KEY
  WARN  ENCRYPTION_KEY
        → Missing. API key storage won't work. Generate: openssl rand -hex 32
  FAIL  Unipile credentials
        → UNIPILE_API_KEY set but UNIPILE_DSN missing. Both required.
        → Connect: http://localhost:3847/keys/connect/unipile
  SKIP  Firecrawl (FIRECRAWL_API_KEY) — not configured (optional)
  PASS  Notion (NOTION_API_KEY)
  PASS  Crustdata (CRUSTDATA_API_KEY)
  SKIP  FullEnrich (FULLENRICH_API_KEY) — not configured (optional)
  SKIP  Instantly (INSTANTLY_API_KEY) — not configured (optional)

Layer 2 — Database
  PASS  Database file
  PASS  Core tables (9/9)
  PASS  FTS5 search index
  PASS  WAL mode
  PASS  Foreign keys

Layer 3 — Configuration
  PASS  GTM framework (~/.gtm-os/framework.yaml)
  PASS  User config (~/.gtm-os/config.yaml)
  WARN  Goals block
        → Goals not yet defined. Edit ~/.gtm-os/config.yaml goals section after your first month of outbound data.
  PASS  Company context (~/.gtm-os/company_context.yaml)

Layer 4 — Provider Connectivity
  PASS  Anthropic API
  FAIL  Crustdata
        → API key invalid or expired.
        → Connect: http://localhost:3847/keys/connect/crustdata
  PASS  Notion
  SKIP  Firecrawl — not configured
  SKIP  FullEnrich — not configured
  SKIP  Instantly — not configured

Layer 5 — Runtime State
  PASS  Rate limit buckets — all buckets have tokens
  PASS  Stored API connections: 4
  SKIP  Project data dirs — per-project (will be created on first use)

Summary: 18 passed, 2 failed, 2 warnings, 6 skipped.
2 issue(s) need attention.

Want me to walk you through fixing the 2 failures?
  1. Open http://localhost:3847/keys/connect/unipile to add your DSN.
     I'll run: yalc-gtm dashboard --route /keys/connect/unipile
  2. Open http://localhost:3847/keys/connect/crustdata to refresh your key.
     I'll run: yalc-gtm dashboard --route /keys/connect/crustdata
```
