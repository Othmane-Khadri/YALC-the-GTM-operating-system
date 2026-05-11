# Team setup

How to get a working dev environment for GTM-OS, including the shared API keys.

## API keys

Keys live in `~/.gtm-os/.env` on each developer's machine. They are **never committed** to either remote.

The full template lives at `.env.example` at the repo root. Copy and fill in:

```bash
cp .env.example ~/.gtm-os/.env
# edit ~/.gtm-os/.env and paste in the values
```

### Where to find the actual values

For Earleads team members:
- **All shared keys** → ping Othmane on Slack DM, or check the team 1Password vault under "GTM-OS / API keys"
- **Personal keys** (your own LinkedIn / Notion / Anthropic) → use your own

The keys you need depend on what you're going to do. Minimum to run anything:
- `ANTHROPIC_API_KEY` — required for all AI reasoning
- `ENCRYPTION_KEY` — generate locally: `openssl rand -hex 32`
- `DATABASE_URL` — defaults to `file:./gtm-os.db` (local SQLite, zero setup)

Add others as you need the matching capabilities. See `.env.example` for what each one unlocks.

## PredictLeads specifically

PredictLeads issues two values together: `PREDICTLEADS_API_KEY` + `PREDICTLEADS_API_TOKEN`. Both must be set; one without the other will 401.

- Vault entry: "GTM-OS / PredictLeads (shared team subscription)"
- Web dashboard: <https://predictleads.com/account/api_subscriptions>
- Plan: 10,000 credits/month, shared across the team. Check live usage by running any `signals:fetch` (output prints remaining cache state) or hitting `/api_subscription` directly.

If we burn through the quota in a given cycle, surface it in #gtm-ops.

## First-time setup

```bash
# 1. Clone (internal repo)
git clone git@github.com:Othmane-Khadri/yalc-internal.git
cd yalc-internal

# 2. Install
npm install

# 3. Apply DB migrations
mkdir -p ~/.gtm-os
sqlite3 ~/.gtm-os/gtm-os.db < src/lib/db/migrations/0000_bootstrap.sql
sqlite3 ~/.gtm-os/gtm-os.db < src/lib/db/migrations/0001_sticky_junta.sql
# (or run `npx drizzle-kit push` and answer "create" for each table)

# 4. Configure env
cp .env.example ~/.gtm-os/.env
# fill in values (see "Where to find the actual values" above)

# 5. Smoke test
npx tsx src/cli/index.ts --help
npx tsx src/cli/index.ts signals:fetch --domain hubspot.com  # uses 4 PredictLeads credits
```

## Tenant config

Each environment can have a tenant config at `~/.gtm-os/tenants/<slug>/adapters.yaml`. The Earleads tenant config is in 1Password as a single file you can drop in.

For everyone: copy your tenant directory into `~/.gtm-os/tenants/<your-slug>/` and either set `GTM_OS_TENANT=<your-slug>` in `~/.gtm-os/.env` or create `.gtm-os-tenant` in your repo cwd with a single line containing the slug. Default tenant is `default`.

## Skills you can use

After setup, Claude Code in this repo will auto-discover the skills in `.claude/skills/`. Trigger phrases:

- `predictleads-signals` — "signals for [company]", "what's happening at [domain]"
- `predictleads-lookalikes` — "find companies like [client]", "lookalikes for [domain]"
- `prospect-discovery-pipeline` — "find prospects like [client]", "build a target list like [domain]"
- `predictleads-dashboard` — "dashboard for [domains]", "visualize signals for [list]"

Plus all the existing GTM-OS skills (campaign-dashboard, debugger, setup, etc.). See `.claude/skills/` for the full list.

For PredictLeads-specific architecture see `docs/predictleads.md`.

## Don't commit

- `.env`, `.env.local`, anything with real values
- `~/.gtm-os/` contents (lives outside the repo by design)
- API keys in test fixtures
- Anything matching the patterns in `.gitignore`

If you suspect you committed a secret, rotate it immediately and ping in #gtm-ops.
