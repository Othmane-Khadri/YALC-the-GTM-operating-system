# Provider Setup Guide

GTM-OS uses external providers to power different capabilities. Only **Anthropic** is required. Everything else is optional and unlocks additional features as you add them.

## Required

### Anthropic (Claude)

Powers all AI reasoning — framework derivation, lead qualification, campaign planning, personalization, orchestration.

| | |
|---|---|
| **Env var** | `ANTHROPIC_API_KEY` |
| **Get it** | https://console.anthropic.com/settings/keys |
| **Format** | `sk-ant-api03-...` |
| **Free tier** | $5 free credits on signup |
| **Pricing** | ~$3/M input tokens, ~$15/M output tokens (Sonnet) |

**What it unlocks:** Everything. Without this key, GTM-OS cannot function.

**Verify:** `yalc-gtm doctor` will check the key is valid.

---

## Tier 2 — Core Features

These providers unlock the main GTM capabilities. Add them as you need them.

### Crustdata

Company and people intelligence. 800M+ professional profiles, 200M+ companies. Powers lead discovery, enrichment, and qualification.

| | |
|---|---|
| **Env var** | `CRUSTDATA_API_KEY` |
| **Get it** | https://crustdata.com/dashboard/api |
| **Pricing** | Credit-based. Company identify is free. People search ~3 credits/100 results. People enrich ~2-5 credits. |

**What it unlocks:**
- `find-companies` — search companies by industry, size, location, funding
- `find-people` — search people by title, company, seniority
- `enrich-leads` — pull company data, headcount, funding, tech stack
- `leads:qualify` — enhanced qualification with company signals
- `competitive-intel` — competitor research with company enrichment

**Verify:** `yalc-gtm doctor` checks the key format. Run `yalc-gtm orchestrate "find 5 SaaS companies in Berlin"` to test.

### Unipile

LinkedIn operations — connect with prospects, send DMs, scrape post engagers, fetch profiles.

| | |
|---|---|
| **Env vars** | `UNIPILE_API_KEY` and `UNIPILE_DSN` |
| **Sign up** | https://www.unipile.com/?utm_source=partner&utm_campaign=Yalc |
| **Get API key** | https://app.unipile.com/settings/api |
| **Note** | You need both the API key AND the DSN (endpoint URL). The DSN looks like `https://api{N}.unipile.com:13{XXX}` |
| **Pricing** | Subscription-based. Check Unipile pricing page. |

**What it unlocks:**
- `campaign:create` — LinkedIn outreach campaigns with A/B variants
- `campaign:track` — Poll LinkedIn for connection accepts, replies, advances sequences
- `leads:scrape-post` — Scrape likers/commenters from any LinkedIn post
- `linkedin:answer-comments` — Reply to comments on your LinkedIn posts
- `personalize` — Pull LinkedIn profile data for message personalization

**Rate limits enforced by GTM-OS:** 30 connection requests/day, 3-second delay between API calls.

**Verify:** `yalc-gtm doctor` validates both keys with a live API call.

### Firecrawl

Web scraping and search. Converts any URL to clean markdown. Used during onboarding to auto-learn from your website.

| | |
|---|---|
| **Env var** | `FIRECRAWL_API_KEY` |
| **Get it** | https://firecrawl.dev/app/api-keys |
| **Free tier** | 500 credits on signup |
| **Pricing** | Credit-based. ~1 credit per page scrape. |

**What it unlocks:**
- Website scraping during `start` onboarding (your site + /about, /pricing, /customers)
- `competitive-intel` — scrape competitor websites for positioning analysis
- `orchestrate` — web research as part of multi-step workflows

**Verify:** `yalc-gtm doctor` scrapes example.com to test connectivity.

### Notion

CRM sync — track campaigns, leads, and results in Notion databases. Bidirectional sync between GTM-OS's SQLite and your Notion workspace.

| | |
|---|---|
| **Env var** | `NOTION_API_KEY` |
| **Get it** | https://www.notion.so/my-integrations |
| **Setup** | Create an integration, copy the "Internal Integration Secret", then share your databases with the integration |
| **Free tier** | Notion API is free |

**What it unlocks:**
- `notion:sync` — bidirectional sync between SQLite and Notion
- `notion:bootstrap` — import existing Notion data into GTM-OS
- Campaign tracking in Notion (leads status, variant performance)

**After adding the key**, configure your Notion database IDs in `~/.gtm-os/config.yaml`:
```yaml
notion:
  campaigns_ds: "your-campaigns-database-id"
  leads_ds: "your-leads-database-id"
  variants_ds: "your-variants-database-id"
  parent_page: "your-parent-page-id"
```

**Verify:** `yalc-gtm doctor` runs a Notion search to test connectivity.

---

## Tier 3 — Specialized

### FullEnrich

Email and phone number enrichment. Takes a name + company and returns verified contact info.

| | |
|---|---|
| **Env var** | `FULLENRICH_API_KEY` |
| **Sign up** | https://fullenrich.com?via=sNO0yIysrHzw |
| **Get API key** | https://app.fullenrich.com/settings |
| **Pricing** | Credit-based. ~1 credit per enrichment. |

**What it unlocks:**
- `enrich-leads` with `type: 'contact'` — adds verified emails and phone numbers
- Enhanced qualification with contact availability signals

### Instantly

Cold email campaign management. Create email sequences, add leads, track opens/replies/bounces.

| | |
|---|---|
| **Env var** | `INSTANTLY_API_KEY` |
| **Sign up** | https://instantly.ai?via=yalc |
| **Get API key** | https://instantly.ai/settings/api |
| **Pricing** | Subscription-based. Check Instantly pricing. |
| **Prerequisite** | You need at least one email sending account configured in Instantly before creating campaigns |

**What it unlocks:**
- `email:create-sequence` — generate email drip sequences
- `send-email-sequence` — send sequences via Instantly
- `multi-channel-campaign` — LinkedIn + email in one campaign
- Campaign analytics (opens, replies, bounces)

**How it works:** GTM-OS creates campaigns in Instantly, adds leads, and tracks results. Sequences must include at least one step with a non-empty body.

### Orthogonal

Universal API gateway — one key gives access to 100+ enrichment, scraping, and AI search APIs.

| | |
|---|---|
| **Env var** | `ORTHOGONAL_API_KEY` |
| **Sign up** | https://www.orthogonal.com/?utm_source=yalc&utm_medium=referral&utm_campaign=in-app |
| **Get API key** | https://orthogonal.com/sign-up |
| **Free tier** | $5 free credits, no card required |

**What it unlocks:**
- Fallback enrichment when primary providers hit rate limits
- Additional search and scraping capabilities
- Access to 100+ APIs through a single key

### Mock (built-in)

Test provider for development. Returns synthetic data. No API key needed.

**What it does:** Returns mock companies, people, and enrichment data. Used in tests and `--dry-run` mode.

---

## Bring your own email provider

Instantly is the default email backend, but YALC can route `email:send` through any provider that advertises the `email_send` capability via the MCP registry. Brevo, Mailgun, and SendGrid ship as templates out of the box.

Three steps to swap in a new provider:

1. **Copy the template** into `~/.gtm-os/mcp/` so it loads on the next CLI invocation:
   ```bash
   yalc-gtm provider:add --mcp brevo
   ```
   The command prints the env vars the template references and whether each is already set.
2. **Set the env var(s)** the template needs in `~/.gtm-os/.env` (or your shell):
   ```bash
   echo "BREVO_API_KEY=xkeysib-..." >> ~/.gtm-os/.env
   ```
3. **Verify connectivity** with the provider health check:
   ```bash
   yalc-gtm provider:test brevo
   ```
   On success, `provider:list` shows the provider as `OK` and you can route a send through it with `email:send --provider brevo`. To make it the default for all sends, set `email.provider: brevo` in `~/.gtm-os/config.yaml`.

The same recipe works for `mailgun` and `sendgrid` — only the env var names change. To stop using a provider, run `yalc-gtm provider:remove <name>`.

---

## Checking Your Setup

Run the doctor command anytime to verify all providers:

```bash
yalc-gtm doctor
```

This runs a 5-layer diagnostic:
1. **Environment** — checks all env vars are present and formatted correctly
2. **Database** — verifies SQLite/Postgres connection and schema
3. **Providers** — makes live API calls to test each configured provider
4. **Context** — checks memory store and tenant configuration
5. **Framework** — verifies your GTM framework is derived and complete

## Adding Keys Later

You can always add new provider keys after initial setup:

1. Add the key to `.env.local`
2. Run `yalc-gtm doctor` to verify
3. The new capabilities are immediately available
