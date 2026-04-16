# Command Reference

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

---

## Leads & Qualification

### `leads:qualify`
Run leads through the 7-gate qualification pipeline.

```bash
yalc-gtm leads:qualify --source csv --input data/leads/sample.csv --dry-run
yalc-gtm leads:qualify --source csv --input data/leads/my-leads.csv
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

---

## LinkedIn

### `linkedin:answer-comments`
Reply to comments on your LinkedIn posts. Requires Unipile.

```bash
yalc-gtm linkedin:answer-comments --url "https://linkedin.com/feed/update/urn:li:activity:123456" --dry-run
```

---

## Email

### `email:create-sequence`
Generate an email drip sequence using Claude.

```bash
yalc-gtm email:create-sequence
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
