# Command Reference

> **Tip:** you can run any of these commands by asking Claude Code in your IDE — see [Quick start in README](../README.md#quick-start).

All commands accept `--tenant <slug>` to scope operations to a specific tenant. All commands that send or write support `--dry-run`.

## Setup & Onboarding

### `start`
Guided onboarding — API keys, company context, framework, and goals in one flow.

```bash
yalc-gtm start
yalc-gtm start --non-interactive    # Use env vars, skip prompts (CI/automation)
```

### `setup`
Check API keys and provider connectivity without re-running onboarding.

```bash
yalc-gtm setup                      # Check current keys
yalc-gtm setup --wizard             # Interactive key-by-key setup
```

### `onboard`
Build GTM framework from LinkedIn profile and/or website (legacy path — `start` is recommended).

```bash
yalc-gtm onboard --website https://acme.com
yalc-gtm onboard --linkedin https://linkedin.com/in/jdoe --website https://acme.com
yalc-gtm onboard --knowledge docs/pitch.md docs/icp.md
```

### `configure`
Set GTM goals and configure skills based on your framework. Requires `onboard` to have run first.

```bash
yalc-gtm configure
```

### `update`
Pull the latest YALC changes, install any new dependencies, and re-run scaffolding — without touching `~/.gtm-os/`.

From source (git clone): switches to `main`, pulls, runs `npx pnpm install` if the lockfile changed, then re-runs `yalc-gtm start --non-interactive` to scaffold any new config fields.

```bash
npx tsx src/cli/index.ts update
# or, if installed globally:
yalc-gtm update
```

Works on macOS, Linux, and Windows.

---

### `doctor`
5-layer health check: environment, database, providers, context, framework.

```bash
yalc-gtm doctor
yalc-gtm doctor --report            # Write diagnostic report to file
```

### `test-run`
End-to-end validation: find → enrich → qualify → review.

```bash
yalc-gtm test-run --count 10
```

### `update`
Pull the latest YALC release without breaking your config.

```bash
yalc-gtm update
```

### `migrate`
Migrate a pre-0.6.0 setup — extracts company context from the legacy `framework.yaml` into its own file.

```bash
yalc-gtm migrate
```

---

## Campaigns

### `campaign:create`
Create a campaign with A/B variant testing and scheduling.

```bash
yalc-gtm campaign:create --title "Q2 Outbound" --hypothesis "VP Eng responds to pain-point messaging"
yalc-gtm campaign:create --title "Q2 Outbound" --auto-copy --segment-id seg-01
yalc-gtm campaign:create --title "Q2 Outbound" --timezone "America/New_York" --send-window "09:00-17:00" --active-days "1,2,3,4,5"
yalc-gtm campaign:create --title "Q2 Outbound" --start-at 2026-05-01 --delay-mode business
```

| Flag | Description |
|------|-------------|
| `--title` | Campaign name |
| `--hypothesis` | What you're testing |
| `--auto-copy` | Generate voice-aware copy via Claude |
| `--segment-id` | ICP segment for voice targeting |
| `--timezone` | IANA timezone (default: Europe/Paris) |
| `--send-window` | HH:mm-HH:mm (default: 09:00-18:00) |
| `--active-days` | 1=Mon..7=Sun comma-separated (default: 1,2,3,4,5) |
| `--delay-mode` | `business` or `calendar` (default: business) |
| `--start-at` | ISO date to auto-activate (campaign starts as 'scheduled') |
| `--leads-filter` | JSON filter for leads from Unified Leads DB |
| `--dry-run` | Preview without writing |

### `campaign:track`
Poll providers, advance sequences, sync with Notion.

```bash
yalc-gtm campaign:track
yalc-gtm campaign:track --campaign-id abc123
yalc-gtm campaign:track --dry-run
```

### `campaign:schedule`
Update schedule on an existing campaign.

```bash
yalc-gtm campaign:schedule --campaign-id abc123 --send-window "10:00-16:00"
yalc-gtm campaign:schedule --campaign-id abc123 --start-at none    # Clear scheduled start
```

### `campaign:report`
Weekly intelligence report for campaigns.

```bash
yalc-gtm campaign:report
```

### `campaign:monthly-report`
Cross-campaign monthly report with intelligence synthesis.

```bash
yalc-gtm campaign:monthly-report
```

### `campaign:create-sequence`
Execute a multi-channel sequence (LinkedIn + email) defined in YAML.

```bash
yalc-gtm campaign:create-sequence --sequence ./sequence.yaml --leads ./leads.csv
yalc-gtm campaign:create-sequence --sequence ./sequence.yaml --linkedin-account acc-123 --dry-run
```

### `campaign:dashboard`
Open the visual campaign dashboard in your browser.

```bash
yalc-gtm campaign:dashboard
yalc-gtm campaign:dashboard --port 4000
```

---

## Leads & Qualification

### `leads:qualify`
Run leads through the 7-gate qualification pipeline.

```bash
yalc-gtm leads:qualify --source csv --input ./leads.csv --dry-run
yalc-gtm leads:qualify --source csv --input ./leads.csv
```

| Flag | Description |
|------|-------------|
| `--source` | Input format: `csv`, `json`, or `notion` |
| `--input` | Path to input file (for csv/json) |
| `--dry-run` | Score without saving results |

### `leads:scrape-post`
Scrape likers and commenters from a LinkedIn post. Requires Unipile.

```bash
yalc-gtm leads:scrape-post --url "https://linkedin.com/feed/update/urn:li:activity:123456"
```

### `leads:import`
Import leads from CSV, JSON, or Notion into GTM-OS.

```bash
yalc-gtm leads:import --source csv --input data/leads/new-leads.csv
```

### `leads:find-linkedin`
Resolve LinkedIn profile URLs from a CSV of names and emails.

```bash
yalc-gtm leads:find-linkedin --input ./leads.csv --output ./leads-with-linkedin.csv
yalc-gtm leads:find-linkedin --input ./leads.csv --dry-run
```

### `leads:dedup`
Deduplicate a result set against active campaigns, CRM contacts, replied leads, and the global blocklist.

```bash
yalc-gtm leads:dedup --result-set rs-abc123
yalc-gtm leads:dedup --result-set rs-abc123 --strategy fuzzy --slack-confirm
```

### `leads:export`
Export a result set to CSV, JSON, Google Sheets, a webhook, or directly into Lemlist / Apollo / Woodpecker.

```bash
yalc-gtm leads:export --result-set rs-abc123 --destination csv --output ./out.csv
yalc-gtm leads:export --result-set rs-abc123 --destination lemlist
yalc-gtm leads:export --result-set rs-abc123 --destination webhook --url https://hooks.example.com/leads
```

### `leads:suppress`
Load a suppression list from an external CSV so those leads are excluded from future runs.

```bash
yalc-gtm leads:suppress --file ./do-not-contact.csv
```

---

## LinkedIn

### `linkedin:answer-comments`
Reply to comments on your LinkedIn posts. Requires Unipile.

```bash
yalc-gtm linkedin:answer-comments --url "https://linkedin.com/feed/update/urn:li:activity:123456" --dry-run
```

### `linkedin:reply-to-comments`
Send threaded replies under LinkedIn comments (never top-level). Supports template rotation and keyword filtering.

```bash
yalc-gtm linkedin:reply-to-comments --url "https://linkedin.com/feed/update/urn:li:activity:123456" --template "Thanks {{name}}!"
yalc-gtm linkedin:reply-to-comments --url <url> --templates "Reply A" "Reply B" --include-keywords pricing demo --max 50
```

---

## Email

### `email:create-sequence`
Generate an email drip sequence using Claude.

```bash
yalc-gtm email:create-sequence
```

### `email:send`
Send a multi-step sequence or a single ad-hoc message via the configured email provider. Routed through the provider registry, so any provider that advertises the `email_send` capability can serve this command (Instantly is built in; Brevo, Mailgun, and SendGrid ship as MCP templates via `provider:add`).

```bash
# Single ad-hoc send through the default provider
yalc-gtm email:send --to lead@example.com --subject "Quick question" --body "Hi there"

# Send through a different provider for this invocation
yalc-gtm email:send --provider brevo --to lead@example.com --body "Hi there"

# Sequence mode (campaign + leads CSV)
yalc-gtm email:send --campaign-name "Q2 Outbound" --source ./leads.csv --sequence ./sequence.yaml
```

| Flag | Description |
|------|-------------|
| `--provider <name>` | Override the configured email provider for this send. Defaults to `email.provider` in `~/.gtm-os/config.yaml`, falling back to `instantly`. |
| `--to`, `--subject`, `--body` | Single-message ad-hoc send (no sequence required). |
| `--campaign-name`, `--source`, `--sequence` | Sequence mode. `--source` is a CSV/JSON of qualified leads. |
| `--generate-from <url>` | Generate a sequence from a target company URL instead of `--sequence`. |
| `--save-sequence <path>` | Save the generated sequence to YAML for reuse. |
| `--from <accountId>` | Email sending account id (provider-specific). |
| `--dry-run` | Preview without sending. |

### `email:status`
Check Instantly campaign analytics (sent, opens, replies).

```bash
yalc-gtm email:status
```

### `email:accounts`
List the Instantly sending accounts connected to your workspace.

```bash
yalc-gtm email:accounts
```

---

## Providers

### `provider:list`
List every registered provider (built-in plus any MCP templates loaded from `~/.gtm-os/mcp/`) with status and capabilities. Providers missing required env vars show as `needs API key`; providers that error out at runtime show as `unreachable`.

```bash
yalc-gtm provider:list
```

### `provider:add`
Copy a shipped MCP template into `~/.gtm-os/mcp/` so it loads on the next CLI invocation. Templates include CRM (`hubspot`, `apollo`, `peopledatalabs`, `zoominfo`) and email (`brevo`, `mailgun`, `sendgrid`).

```bash
yalc-gtm provider:add --mcp brevo
```

The command prints which env vars the template references and which are already set.

### `provider:test`
Run the provider's health check (and, for MCP providers, list discovered tools).

```bash
yalc-gtm provider:test brevo
yalc-gtm provider:test instantly
```

### `provider:remove`
Delete an MCP provider config from `~/.gtm-os/mcp/`. The provider stops loading on the next invocation.

```bash
yalc-gtm provider:remove brevo
```

### `keys:connect`
Open the local `/keys/connect` form for a provider (or agnostic mode) and wait for the sentinel handshake. The canonical way to wire up an API key.

```bash
yalc-gtm keys:connect crustdata
yalc-gtm keys:connect unipile --open
yalc-gtm keys:connect             # Agnostic mode (pick provider in the UI)
```

### `connect-provider`
Legacy alias that wraps `keys:connect` and also performs an end-to-end provider verification.

```bash
yalc-gtm connect-provider crustdata
```

---

## Notion Integration

### `notion:sync`
Bidirectional sync between GTM-OS SQLite and Notion databases. Requires Notion key + database IDs in config.

```bash
yalc-gtm notion:sync
```

### `notion:bootstrap`
One-time import of existing Notion data into GTM-OS.

```bash
yalc-gtm notion:bootstrap
```

---

## Orchestration

### `orchestrate`
Describe what you want in natural language. Claude decomposes it into skills and executes.

```bash
yalc-gtm orchestrate "find 10 SaaS companies in Berlin with 50-200 employees"
yalc-gtm orchestrate "research our top 3 competitors and compare their positioning"
yalc-gtm orchestrate "find VP Engineering at companies using React, qualify them, and create a campaign"
```

---

## Background Agents

### `agent:create`
Interactive wizard to create a background agent configuration.

```bash
yalc-gtm agent:create
```

### `agent:run`
Run a background agent immediately.

```bash
yalc-gtm agent:run --agent daily-linkedin-scraper --post-url "https://linkedin.com/..."
yalc-gtm agent:run --agent my-custom-agent
```

### `agent:install`
Install an agent as a macOS launchd service for automatic scheduling.

```bash
yalc-gtm agent:install --agent my-custom-agent
```

### `agent:list`
List all agents with their last run status.

```bash
yalc-gtm agent:list
```

---

## Skills Marketplace

### `skills:browse`
Browse available skills in the marketplace.

```bash
yalc-gtm skills:browse
```

### `skills:search`
Search for skills by keyword.

```bash
yalc-gtm skills:search "email"
```

### `skills:install`
Install a skill from GitHub or local path.

```bash
yalc-gtm skills:install --github user/repo
yalc-gtm skills:install --local ./my-skill
```

### `skills:info`
Show detailed information about a skill.

```bash
yalc-gtm skills:info qualify-leads
```

### `skills:run`
Execute an installed skill with the given inputs.

```bash
yalc-gtm skills:run qualify-leads --input company=acme.com --input role="VP Eng"
yalc-gtm skills:run qualify-leads --input-file inputs.json --output result.json
```

### `skills:create`
Scaffold a new skill interactively (Markdown by default, TypeScript optional).

```bash
yalc-gtm skills:create
yalc-gtm skills:create --format typescript
yalc-gtm skills:create --non-interactive   # Fail instead of prompting
```

### `skills:validate`
Validate a Markdown skill file's manifest without registering it.

```bash
yalc-gtm skills:validate ./my-skill/SKILL.md
```

---

## Memory & Context (Multi-Tenant)

### `tenant:onboard`
Onboard a new tenant with interactive interview or context adapter.

```bash
yalc-gtm tenant:onboard --tenant acme
yalc-gtm tenant:onboard --tenant acme --adapter markdown-folder
yalc-gtm tenant:onboard --tenant acme --no-scrape
```

### `framework:derive`
Derive a GTM framework from the tenant's memory state.

```bash
yalc-gtm framework:derive --tenant acme
```

### `memory:retrieve`
Search the tenant's memory store using hybrid retrieval.

```bash
yalc-gtm memory:retrieve --query "what are our main competitors" --tenant acme
yalc-gtm memory:retrieve --query "ICP pain points" --top-k 5
```

### `memory:dream`
Run the memory lifecycle — generate clusters, promote insights, archive stale nodes, rebuild indexes.

```bash
yalc-gtm memory:dream --tenant acme
yalc-gtm memory:dream --incremental
```

### `memory:index`
Rebuild the `MEMORY.md`-style pointer index for the tenant.

```bash
yalc-gtm memory:index --tenant acme
```

### `context:sync`
Run context adapters to sync external data into memory.

```bash
yalc-gtm context:sync --tenant acme
```

### `context:watch`
Long-lived daemon that watches for context changes and syncs automatically.

```bash
yalc-gtm context:watch --tenant acme
```

---

## Results & Review

### `results:review`
Review and provide feedback on qualification results. Feeds the intelligence store.

```bash
yalc-gtm results:review --result-set rs-abc123
```

---

## Research & Personalization

### `research`
AI research agent — answer any question about a company, person, or topic with cited evidence.

```bash
yalc-gtm research --target-type company --target acme.com --question "What's their pricing model?"
yalc-gtm research --target-type person --target "Jane Doe @ Acme"
yalc-gtm research --target-type topic --question "How are SaaS firms pricing AI features in 2026?" --max-sources 8
```

### `competitive-intel`
Scrape, enrich, analyze, and write a competitor profile.

```bash
yalc-gtm competitive-intel --url https://competitor.com
yalc-gtm competitive-intel --url https://competitor.com --enrich
```

### `personalize`
Auto-personalize an outreach message for a single lead using LinkedIn, Firecrawl, Crustdata, and your intelligence store.

```bash
yalc-gtm personalize --first-name Jane --last-name Doe --company acme.com --template ./template.md
```

---

## Signals (PredictLeads)

### `signals:fetch`
Pull PredictLeads signals for a single company domain (jobs, funding, tech, news, similar).

```bash
yalc-gtm signals:fetch --domain acme.com
yalc-gtm signals:fetch --domain acme.com --types jobs,funding --no-cache
yalc-gtm signals:fetch --domain acme.com --ttl-days 14
```

### `signals:enrich`
Pull signals for every unique domain in a result set.

```bash
yalc-gtm signals:enrich --result-set rs-abc123
yalc-gtm signals:enrich --result-set rs-abc123 --types jobs,news --ttl-days 7
```

### `signals:show`
Read cached signals for a domain from local SQLite — does not hit the API.

```bash
yalc-gtm signals:show --domain acme.com
yalc-gtm signals:show --domain acme.com --type jobs --limit 50
```

### `signals:list`
List every signal watch with its last-checked timestamp.

```bash
yalc-gtm signals:list
```

### `signals:similar`
Fetch lookalike companies for a domain (account discovery).

```bash
yalc-gtm signals:similar --domain acme.com --limit 25
```

### `signals:watch`
Add companies or people to the signal watch list.

```bash
yalc-gtm signals:watch --domains acme.com,beta.io
yalc-gtm signals:watch --domains acme.com --types job-change,funding --force
```

### `signals:detect`
Run signal detection now against the watch list.

```bash
yalc-gtm signals:detect
yalc-gtm signals:detect --type funding --company acme.com
```

### `signals:triggers`
Manage trigger configurations — what should happen when a signal fires (Slack ping, enrich, qualify, kick off a campaign, write to intelligence).

```bash
yalc-gtm signals:triggers list
yalc-gtm signals:triggers set --signal funding --action slack --channel "#gtm-alerts" --template "{{company}} just raised"
yalc-gtm signals:triggers set --signal hiring-surge --action campaign --campaign-id camp-123
```

---

## Frameworks (Playbooks)

Frameworks are installable, schedulable GTM playbooks (e.g. "Outbound SaaS US v1"). They run on a cron, write to Notion or the dashboard, and can pause for human review.

### `framework:list`
List every bundled and installed framework.

```bash
yalc-gtm framework:list
```

### `framework:recommend`
Claude recommends frameworks based on your configured providers and captured context.

```bash
yalc-gtm framework:recommend
```

### `framework:install`
Install a framework — pick output destination, schedule, and seed run.

```bash
yalc-gtm framework:install outbound-saas-us
yalc-gtm framework:install outbound-saas-us --destination notion --notion-parent <pageId> --auto-confirm
```

### `framework:run`
Run an installed framework now (off-schedule).

```bash
yalc-gtm framework:run outbound-saas-us
yalc-gtm framework:run outbound-saas-us --seed --open
```

### `framework:status`
Show last run, next scheduled run, and output destination for an installed framework.

```bash
yalc-gtm framework:status outbound-saas-us
```

### `framework:logs`
Show the most recent run for an installed framework.

```bash
yalc-gtm framework:logs outbound-saas-us
```

### `framework:resume`
Resume a framework run that paused at a human-gate step.

```bash
yalc-gtm framework:resume outbound-saas-us --from-gate run-abc123
```

### `framework:disable`
Pause scheduled runs for an installed framework. Config is preserved.

```bash
yalc-gtm framework:disable outbound-saas-us
```

### `framework:remove`
Remove an installed framework — deletes config, agent yaml, and run history.

```bash
yalc-gtm framework:remove outbound-saas-us
```

---

## CRM Sync

### `crm:setup`
Interactive wizard to wire up a CRM (HubSpot, Salesforce, Pipedrive) via MCP and confirm field mappings.

```bash
yalc-gtm crm:setup
yalc-gtm crm:setup --non-interactive   # Auto-accept all suggested mappings
```

### `crm:import`
Import contacts and companies from your CRM into local SQLite.

```bash
yalc-gtm crm:import
yalc-gtm crm:import --dry-run
```

### `crm:push`
Push enriched leads from a result set up to the CRM.

```bash
yalc-gtm crm:push --result-set rs-abc123
yalc-gtm crm:push --result-set rs-abc123 --dry-run
```

### `crm:sync`
Bidirectional sync between GTM-OS and the CRM.

```bash
yalc-gtm crm:sync
yalc-gtm crm:sync --direction push
yalc-gtm crm:sync --direction pull --dry-run
```

### `crm:status`
Show the current CRM mapping and the last successful sync time.

```bash
yalc-gtm crm:status
```

### `crm:verify`
Detect schema drift — compares your saved mapping against live MCP tools and flags any breakage.

```bash
yalc-gtm crm:verify
```

---

## Pipelines

Pipelines are declarative YAML workflows that chain multiple commands together with checkpoints.

### `pipeline:create`
Create a new pipeline YAML from a template.

```bash
yalc-gtm pipeline:create --name nightly-icp-refresh
yalc-gtm pipeline:create --name nightly-icp-refresh --output ./pipelines/icp.yaml
```

### `pipeline:list`
List available pipelines from `~/.gtm-os/pipelines/` and `configs/pipelines/`.

```bash
yalc-gtm pipeline:list
```

### `pipeline:run`
Execute a declarative YAML pipeline.

```bash
yalc-gtm pipeline:run --pipeline nightly-icp-refresh
yalc-gtm pipeline:run --pipeline nightly-icp-refresh --dry-run
```

### `pipeline:resume`
Resume a failed or interrupted pipeline from its last checkpoint.

```bash
yalc-gtm pipeline:resume --run-id run-abc123
```

### `pipeline:status`
Show the current state of a running, failed, or completed pipeline.

```bash
yalc-gtm pipeline:status --run-id run-abc123
```

---

## Visualization

### `visualize`
Generate a tailored interactive HTML page from local JSON data plus an intent prompt — useful for ad-hoc dashboards, weekly reports, and prospect-facing roadmaps.

```bash
yalc-gtm visualize campaign-overview --data './data/campaigns/*.json'
yalc-gtm visualize qualification-summary --data ./out/qualified.json --data ./out/unqualified.json
```
