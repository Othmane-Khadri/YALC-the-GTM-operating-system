# YALC — The Open-Source GTM Operating System

![CI](https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system/actions/workflows/ci.yml/badge.svg)
[![npm version](https://img.shields.io/npm/v/yalc-gtm-os.svg)](https://www.npmjs.com/package/yalc-gtm-os)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-brightgreen.svg)](https://nodejs.org/)

> AI plans your campaigns, qualifies your leads, and learns from every interaction.

YALC is an open-source, AI-native operating system for running any GTM campaign. CLI-first. Intelligence compounds from every interaction.

## Quick start

Node.js 20 or higher required ([nodejs.org](https://nodejs.org/)).

### Option A — Drive YALC from your IDE (recommended)
Open this repo in Cursor or VS Code with the Claude Code extension installed.
In the chat panel, paste this repo URL or just say "let's start".
Claude will introduce YALC, check your prerequisites, and walk you through setup.

### Option B — Use the CLI directly
```bash
npm i -g yalc-gtm-os
yalc-gtm start
```

That is the whole installation. The `start` command writes its config to `~/.gtm-os/`, asks for your company website URL, then opens the browser at `/setup/review` so you can confirm the inferred framework. No long terminal interview by default.

YALC is a CLI; there's no public Node API to import.

### Updating

```bash
npm update -g yalc-gtm-os
```

### From source (contributors)

If you want to hack on YALC itself, clone the repo and link locally:

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
corepack enable && corepack prepare pnpm@latest --activate
pnpm install
pnpm link --global
```

If `pnpm link --global` fails with `ERR_PNPM_NO_GLOBAL_BIN_DIR` (or you are on Windows), run YALC in-repo with `pnpm cli start` instead.

What `yalc-gtm start` does:

1. Prompts you for your company website URL (one question, that is it).
2. Scaffolds `~/.gtm-os/` and writes a `.env` template the first time it runs.
3. Scrapes the website, runs synthesis, and stages a draft framework into `_preview/`.
4. Spawns a local dashboard server on port 3847 and opens `http://localhost:3847/setup/review` in your browser so you can confirm or edit each section before committing.

High-confidence sections auto-commit; low-confidence ones queue at `/setup/review` for your sign-off. You can re-run any section from the SPA or via `yalc-gtm start --regenerate <section>`.

If you do not have an `ANTHROPIC_API_KEY` set, the framework synthesis steps are skipped — you can add the key later and re-run `yalc-gtm onboard` then `yalc-gtm configure`. Inside Claude Code, the parent session provides the LLM + WebFetch, so no Anthropic / Firecrawl keys are required.

### Prefer a terminal interview?

If you would rather walk through the legacy 4-step terminal interview instead of opening the browser, pass `--review-in-chat`:

```bash
yalc-gtm start --review-in-chat
```

### Non-Interactive Setup

For CI or automation, set your keys in `~/.gtm-os/.env` (or `.env.local` in your project) and run:

```bash
yalc-gtm start --non-interactive
```

A minimal env file looks like:

```env
ANTHROPIC_API_KEY=sk-ant-...
UNIPILE_API_KEY=...
UNIPILE_DSN=https://api{N}.unipile.com:{PORT}
NOTION_API_KEY=secret_...
ENCRYPTION_KEY=$(openssl rand -hex 32)
```

## Features at a Glance

- **20 built-in skills** — qualify, scrape, campaign, orchestrate, personalize, competitive-intel, and more
- **7 providers** — Unipile, Crustdata, Firecrawl, Notion, FullEnrich, Instantly, Anthropic
- **Multi-channel campaigns** — LinkedIn + Email with A/B variant testing
- **Intelligence store** — learns from every campaign outcome (hypothesis → validated → proven)
- **Statistical significance** — chi-squared testing to pick variant winners
- **Campaign dashboard** — real-time analytics, funnel views, Claude-powered Q&A
- **Rate limiting** — DB-backed token bucket on all external sends
- **Outbound validation** — every message checked before send, hard blocks on violations
- **Background agents** — launchd-integrated for automated campaign tracking
- **Natural language orchestration** — describe what you want, YALC plans the workflow
- **Swappable email providers** — Instantly built in, plus drop-in MCP templates for Brevo, Mailgun, and SendGrid (`provider:add --mcp <name>` then `email:send --provider <name>`)

<!-- ## Demo
![YALC Demo](demo.gif)
Demo GIF will be added here -->

## Using YALC from Claude Code (IDE or Terminal)

YALC works the same whether you run it from a coding IDE (VS Code, Cursor) or a standalone terminal. The CLI uses the same interactive prompts in both.

**IDE (VS Code / Cursor with Claude Code extension):**
You can ask Claude Code to run commands for you. For the initial setup, it's better to run `yalc-gtm start` yourself in the integrated terminal so you can answer the interactive prompts. After that, Claude Code can run any YALC command on your behalf — qualifying leads, creating campaigns, tracking results.

If your `ANTHROPIC_API_KEY` is already in your environment (common in Claude Code sessions), the `start` command detects it automatically and skips the prompt.

**Terminal (standalone):**
Run commands directly. The interactive prompts work as expected in any terminal emulator.

### Running YALC inside Claude Code (no extra keys required)

When YALC detects a parent Claude Code session — via `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CLAUDE_CODE_SSE_PORT` env vars set by Claude Code itself — both the **Anthropic** and **Firecrawl** keys become **optional**:

- The parent CC session already provides LLM reasoning, so a separate Anthropic API key isn't needed for ad-hoc planning, qualification, or personalization (just ask Claude Code).
- Claude Code's built-in `WebFetch` tool covers single-URL scrapes, so Firecrawl is only needed for JS-rendered pages, multi-page crawls, or web search.
- Claude Code's `WebSearch` is also honored when onboarding needs to discover a company URL — if you skip the website prompt, YALC asks the parent CC session to run a `WebSearch` for `"<company> official website"` instead of calling Firecrawl.

**What works in Claude Code mode with zero provider keys:**

| Command | Works? | Notes |
|---|---|---|
| `start` | ✓ | Steps 1–2 complete; Steps 3–4 (framework synth, goals) are skipped with a "come back after adding ANTHROPIC_API_KEY" message |
| `leads:import` | ✓ | Pure CSV/JSON ingest, no LLM |
| `campaign:create` (with `--title` + `--hypothesis`) | ✓ | LLM is only used for the optional auto-plan path |
| `campaign:track`, `campaign:schedule`, `campaign:report` (data-only) | ✓ | Pure CRUD against Notion / DB |
| `notion:sync`, `notion:bootstrap` | ✓ | |
| `email:send`, `email:status` | ✓ | Sends pre-written copy via Instantly |
| `orchestrate`, `leads:qualify`, `personalize`, `competitive-intel` | Redirect | Prints a message and exits cleanly without doing the work. Re-issue the request inside a Claude Code session so the parent LLM runs it, or add an `ANTHROPIC_API_KEY` and run again standalone. |

**When you DO still want an Anthropic key:**

- Running YALC standalone (no parent CC session)
- Running YALC under cron, launchd, CI, or any unattended scheduler
- You want the qualifier / personalizer / orchestrator to run autonomously without you babysitting it from a CC chat

**Web-fetch provider override** — set `WEB_FETCH_PROVIDER` in `.env.local`:

- `auto` (default) — use Firecrawl if present, otherwise hand off to Claude Code's WebFetch
- `firecrawl` — force Firecrawl, error if no key
- `claude-code` — never call Firecrawl; commands that need a web fetch will emit a "fetch this URL with WebFetch and re-run with `--input <file>`" handoff

**File Structure — Where Things Live:**

```
~/.gtm-os/                          Your GTM brain (persists across projects)
├── config.yaml                     Provider settings, Notion IDs, rate limits
├── framework.yaml                  GTM framework — ICP, positioning, signals
├── qualification_rules.md          Lead qualification patterns (auto-generated)
├── campaign_templates.yaml         Outreach copy templates (auto-generated)
├── search_queries.txt              Monitoring keywords (auto-generated)
├── logs/agents/                    Background agent run logs (JSON per run)
└── tenants/<slug>/                 Per-tenant overrides (multi-company mode)

./data/                             Working data (in your project directory)
├── leads/                          CSV/JSON lead lists for qualification
├── intelligence/                   Campaign learnings and insights
└── campaigns/                      Campaign exports and reports
```

When talking to Claude Code, reference these locations directly:
- "Update my qualification rules" → edits `~/.gtm-os/qualification_rules.md`
- "Add a segment to my framework" → edits `~/.gtm-os/framework.yaml`
- "Qualify leads from this CSV" → reads from `./data/leads/`

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                        CLI Layer                          │
│  campaign:track · campaign:create · leads:qualify · ...   │
├──────────────────────────────────────────────────────────┤
│                      Skills Layer                         │
│  qualify · scrape-linkedin · answer-comments · email ·    │
│  orchestrate · visualize · monthly-report                 │
├──────────────────────────────────────────────────────────┤
│                    Providers Layer                         │
│  Unipile · Crustdata · Firecrawl · Notion · FullEnrich   │
├──────────────────────────────────────────────────────────┤
│                    Services Layer                          │
│  API wrappers · Rate limiter · Outbound validator         │
├──────────────────────────────────────────────────────────┤
│                    Data Layer                              │
│  Drizzle ORM · SQLite/Turso · Intelligence Store          │
└──────────────────────────────────────────────────────────┘
```

**Three-layer pattern:** Service (API wrapper) → Provider (StepExecutor) → Skill (user-facing operation). Never skip layers.

## Providers

YALC ships providers in two forms: **built-in TypeScript adapters** (compiled into the package) and **bundled declarative manifests** (YAML under `configs/adapters/`). Both surface through the same capability registry. Run `yalc-gtm adapters:list` for the live view.

### Built-in TypeScript adapters

| Provider | Capabilities | Env Var |
|----------|-------------|---------|
| **Unipile** | LinkedIn search, connections, DMs, scraping | `UNIPILE_API_KEY`, `UNIPILE_DSN` |
| **Crustdata** | Company/people search, enrichment | `CRUSTDATA_API_KEY` |
| **Firecrawl** | Web scraping, search (optional inside Claude Code) | `FIRECRAWL_API_KEY` |
| **Notion** | Database sync, page management | `NOTION_API_KEY` |
| **FullEnrich** | Email/phone enrichment | `FULLENRICH_API_KEY` |
| **Instantly** | Cold email sending, sequence management | `INSTANTLY_API_KEY` |
| **Anthropic** | AI planning, qualification, personalization (optional inside Claude Code) | `ANTHROPIC_API_KEY` |
| **Voyage** | Embeddings (memory) | `VOYAGE_API_KEY` |
| **Playwright** | Asset rendering (PDF/PNG from HTML) — optional dep | `pnpm add playwright` |

> **Note on `asset-rendering`:** the `playwright` provider is shipped as an [optional dependency](docs/providers.md#optional-asset-rendering-playwright). HTML rendering always works; PDF/PNG rendering kicks in once you `pnpm add playwright && npx playwright install chromium`.

### Bundled declarative adapters

| Capability | Provider | Env Var | Manifest |
|---|---|---|---|
| `people-enrich` | peopledatalabs | `PEOPLEDATALABS_API_KEY` | `configs/adapters/people-enrich-peopledatalabs.yaml` |
| `crm-contact-upsert` | hubspot | `HUBSPOT_API_KEY` | `configs/adapters/crm-contact-upsert-hubspot.yaml` |
| `email-campaign-create` | brevo | `BREVO_API_KEY` | `configs/adapters/email-campaign-create-brevo.yaml` |
| `landing-page-deploy` | vercel | `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`) | `configs/adapters/landing-page-deploy-vercel.yaml` |

Counts at this commit: 20 built-in TypeScript adapters across 18 capabilities; 4 bundled declarative manifests. See [docs/providers.md](docs/providers.md#bundled-declarative-providers) for setup and override semantics.

## Skills

YALC ships skills across three distinct runtime systems. See [CONTRIBUTING.md](CONTRIBUTING.md#skills) for the full distinction.

### Bundled Claude Code skills (`.claude/skills/`)

Conversational entry points. Activate from a Claude Code session with the trigger phrases in each skill's `description` frontmatter.

| Skill | What it does |
|-------|--------------|
| `campaign-dashboard` | Opens the local campaign visualization dashboard in the browser |
| `debugger` | 5-layer diagnostic funnel for any failing GTM-OS CLI command |
| `predictleads-dashboard` | Generates a self-contained HTML page from cached PredictLeads signals |
| `predictleads-lookalikes` | Pulls up to 50 companies similar to a seed domain (1 credit per seed) |
| `predictleads-signals` | Single-company signal lookup (jobs, financing, news, tech) with 7-day cache |
| `prospect-discovery-pipeline` | Meta-skill: chains lookalikes → ICP filter → CMO finder → signals → 2 LinkedIn variants |
| `provider-builder` | Authors a declarative adapter manifest from vendor + capability + docs URL in ~5 min |
| `setup` | New-user onboarding: install, env, capture, preview, commit, doctor, framework recommend |

**16 more skills shipping in 0.13.0** — see [CHANGELOG.md](CHANGELOG.md) and [docs/skills-architecture.md](docs/skills-architecture.md).

### Legacy TypeScript skill registry (`src/lib/skills/builtin/`)

Loaded at runtime by `orchestrate` and surfaced via `skills:list`.

| Skill | Category | Description |
|-------|----------|-------------|
| `qualify-leads` | data | 7-gate lead qualification pipeline |
| `scrape-linkedin` | data | Scrape post engagers (likers/commenters) |
| `answer-comments` | outreach | Reply to LinkedIn post comments |
| `email-sequence` | content | Generate email drip sequences |
| `visualize-campaigns` | analysis | Campaign dashboards |
| `monthly-campaign-report` | analysis | Cross-campaign intelligence report |
| `orchestrate` | integration | Multi-step workflow from natural language |

## Documentation

| Guide | What it covers |
|-------|---------------|
| [First Run Tutorial](docs/first-run.md) | Step-by-step walkthrough of `start`, plus 3 mini-tutorials |
| [Provider Setup](docs/providers.md) | How to get and configure API keys for each provider |
| [Command Reference](docs/commands.md) | Every CLI command with flags, examples, and expected output |
| [Skills Catalog](docs/skills.md) | All 20 built-in skills with scenarios and decision tree |
| [MCP Integration](docs/mcp.md) | How MCP works with GTM-OS, current status, and roadmap |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and fixes, organized by layer |
| [Background Agents](docs/background-agents.md) | Agent architecture, creation, scheduling |
| [Intelligence Store](data/intelligence/README.md) | Intelligence schema, categories, confidence lifecycle |
| [Architecture](docs/ARCHITECTURE.md) | High-level project map |
| [Systems Architecture](docs/SYSTEMS_ARCHITECTURE.md) | Deep dive into 8 core systems |

## Configuration

YALC uses `~/.gtm-os/config.yaml` for persistent configuration:

```yaml
notion:
  campaigns_ds: ""
  leads_ds: ""
  variants_ds: ""
  parent_page: ""
unipile:
  daily_connect_limit: 30
  sequence_timing:
    connect_to_dm1_days: 2
    dm1_to_dm2_days: 3
  rate_limit_ms: 3000
qualification:
  rules_path: ~/.gtm-os/qualification_rules.md
  exclusion_path: ~/.gtm-os/exclusion_list.md
  disqualifiers_path: ~/.gtm-os/company_disqualifiers.md
  cache_ttl_days: 30
crustdata:
  max_results_per_query: 50
fullenrich:
  poll_interval_ms: 2000
  poll_timeout_ms: 300000
memory:
  embeddings:
    provider: voyage   # voyage (default) | openai
```

### Env file precedence

YALC loads `~/.gtm-os/.env` automatically on every run (followed by `.env.local` in the current working directory as a fallback). Variables already present in your shell environment win — `~/.gtm-os/.env` only fills in keys that aren't already set. To stop using a provider, remove its line from `~/.gtm-os/.env` rather than `unset`-ing it in your terminal, since the file is reloaded on the next invocation.

## Key Design Decisions

- **Intelligence everywhere**: Every campaign outcome feeds the intelligence store. The system learns what works per segment/channel.
- **Outbound validation**: Every human-facing message passes through `validateMessage()`. Hard violations block sends.
- **Rate limiting**: DB-backed token bucket rate limiter on all external sends (LinkedIn connects, DMs, emails).
- **No silent mocks**: Provider registry throws `ProviderNotFoundError` with suggestions instead of silently falling back to mock data.
- **Transactions**: All campaign tracker DB writes are wrapped in Drizzle transactions.

## Contributing

1. Follow the three-layer pattern: Service → Provider → Skill
2. Run `pnpm typecheck` after every file change
3. Support `--dry-run` on any command that sends or writes
4. Never log API keys — use `sk-...redacted` pattern
5. Wire campaign outcomes to the intelligence store

## All commands

```
start                   Guided onboarding — keys, context, framework, goals in one flow
setup                   Check API keys and provider connectivity
onboard                 Build GTM framework from profile/website
campaign:track          Poll Unipile, advance sequences, sync Notion
campaign:create         Create campaign with A/B variant testing
campaign:report         Generate weekly intelligence report
campaign:monthly-report Cross-campaign monthly report
campaign:dashboard      Open visualization dashboard
leads:qualify           Run 7-gate qualification pipeline
leads:scrape-post       Scrape LinkedIn post engagers
leads:import            Import leads from CSV/JSON/Notion
linkedin:answer-comments Reply to LinkedIn post comments
email:send              Send a sequence or single message (pick the email provider with --provider <name>)
email:create-sequence   Generate email drip sequence
notion:sync             Bidirectional SQLite ↔ Notion sync
notion:bootstrap        Import existing Notion data to SQLite
orchestrate             Natural language → phased skill execution
agent:run               Run background agent immediately
agent:install           Install agent as launchd service
agent:list              List agents with last run status
```

The listing above covers the common commands. The full surface also includes the `crm:*` (CRM sync and import), `email:*` (send, accounts, status), `provider:*`, `memory:*`, `context:*`, `pipeline:*`, `skills:*`, and `tenant:*` families, plus `configure`, `doctor`, `update`, `personalize`, `competitive-intel`, `test-run`, and `campaign:schedule`. Run `yalc-gtm --help` for the complete list.

All commands that send or write support `--dry-run`. See [Command Reference](docs/commands.md) for full details, flags, and examples.

### Common after-setup recipes

```bash
# Easiest: describe what you want in natural language and let YALC plan the work
yalc-gtm orchestrate "find 10 SaaS CTOs matching my ICP and qualify them"

# Create a campaign
yalc-gtm campaign:create --title "Q2 Outbound" --hypothesis "VP Eng responds to pain-point messaging"

# Track campaign progress
yalc-gtm campaign:track --dry-run

# Or qualify a lead list you already have (CSV or JSON)
yalc-gtm leads:qualify --source csv --input ./your-leads.csv --dry-run

# Send via a non-default email provider (e.g. Brevo via the MCP template)
yalc-gtm email:send --provider brevo --to lead@example.com --body "Hi there"
```

## License

MIT
