# YALC — The Open-Source GTM Operating System

![CI](https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system/actions/workflows/ci.yml/badge.svg)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> AI plans your campaigns, qualifies your leads, and learns from every interaction.

YALC is an open-source, AI-native operating system for running any GTM campaign. CLI-first. Intelligence compounds from every interaction.

## Quick Start

### Prerequisites

- Node.js version 20 or higher ([nodejs.org](https://nodejs.org/))
- pnpm: run `corepack enable && corepack prepare pnpm@latest --activate` (or see the [pnpm install guide](https://pnpm.io/installation))
- Git

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
pnpm install

# Make the CLI available
pnpm link --global

# One command to set up everything
yalc-gtm start
```

### If `pnpm link --global` fails

If you see `ERR_PNPM_NO_GLOBAL_BIN_DIR`, or you are on Windows, skip the global link and run YALC in-repo: `pnpm cli start`. This uses the `cli` script defined in `package.json` and works without any global bin directory.

The `start` command walks you through 4 steps:

1. **Environment** — Collects API keys. All keys are optional; setup never blocks on a missing one. Without `ANTHROPIC_API_KEY` you can still complete onboarding — Steps 3–4 are skipped and can be finished later by running `yalc-gtm onboard` then `yalc-gtm configure`. When run inside Claude Code, both `ANTHROPIC_API_KEY` and `FIRECRAWL_API_KEY` default to skip (the parent CC session covers LLM + WebFetch).
2. **Company Context** — Interactive interview about your company, ICP, pain points, competitors, and voice. Optionally scrapes your website for additional context.
3. **Framework** *(skipped without an Anthropic key)* — Claude synthesizes everything into a structured GTM framework (segments, signals, positioning, competitors).
4. **Goals & Config** *(skipped without an Anthropic key)* — Claude recommends goals and generates qualification rules, outreach templates, and search queries.

You'll end with a readiness report showing what's unlocked and a suggested first command.

### Updating

Already set up? One command to pull the latest:

```bash
yalc-gtm update
```

This stashes any local changes, pulls from origin, reinstalls deps, and restores your changes. Your `~/.gtm-os/` config is never touched.

### After Setup

```bash
# Run your first qualification (dry-run)
yalc-gtm leads:qualify --source csv --input data/leads/sample.csv --dry-run

# Create a campaign
yalc-gtm campaign:create --title "Q2 Outbound" --hypothesis "VP Eng responds to pain-point messaging"

# Track campaign progress
yalc-gtm campaign:track --dry-run

# Or just describe what you want in natural language
yalc-gtm orchestrate "find 10 companies matching my ICP"
```

### Non-Interactive Setup

For CI or automation, set your keys in `.env.local` (see `.env.example`) and run:

```bash
yalc-gtm start --non-interactive
```

## Features at a Glance

- **16 built-in skills** — qualify, scrape, campaign, orchestrate, personalize, competitive-intel, and more
- **7 providers** — Unipile, Crustdata, Firecrawl, Notion, FullEnrich, Instantly, Mock
- **Multi-channel campaigns** — LinkedIn + Email with A/B variant testing
- **Intelligence store** — learns from every campaign outcome (hypothesis → validated → proven)
- **Statistical significance** — chi-squared testing to pick variant winners
- **Campaign dashboard** — real-time analytics, funnel views, Claude-powered Q&A
- **Rate limiting** — DB-backed token bucket on all external sends
- **Outbound validation** — every message checked before send, hard blocks on violations
- **Background agents** — launchd-integrated for automated campaign tracking
- **Natural language orchestration** — describe what you want, YALC plans the workflow

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

**What works in Claude Code mode with zero provider keys:**

| Command | Works? | Notes |
|---|---|---|
| `start` | ✓ | Steps 1–2 complete; Steps 3–4 (framework synth, goals) are skipped with a "come back after adding ANTHROPIC_API_KEY" message |
| `leads:import` | ✓ | Pure CSV/JSON ingest, no LLM |
| `campaign:create` (with `--title` + `--hypothesis`) | ✓ | LLM is only used for the optional auto-plan path |
| `campaign:track`, `campaign:schedule`, `campaign:report` (data-only) | ✓ | Pure CRUD against Notion / DB |
| `notion:sync`, `notion:bootstrap` | ✓ | |
| `email:send`, `email:status` | ✓ | Sends pre-written copy via Instantly |
| `orchestrate`, `leads:qualify`, `personalize`, `competitive-intel` | Redirect | Print a "set ANTHROPIC_API_KEY or reformulate as a CC prompt" message and exit cleanly (no stack trace) |

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

| Provider | Capabilities | Env Var |
|----------|-------------|---------|
| **Unipile** | LinkedIn search, connections, DMs, scraping | `UNIPILE_API_KEY`, `UNIPILE_DSN` |
| **Crustdata** | Company/people search, enrichment | `CRUSTDATA_API_KEY` |
| **Firecrawl** | Web scraping, search (optional inside Claude Code) | `FIRECRAWL_API_KEY` |
| **Notion** | Database sync, page management | `NOTION_API_KEY` |
| **FullEnrich** | Email/phone enrichment | `FULLENRICH_API_KEY` |
| **Anthropic** | AI planning, qualification, personalization (optional inside Claude Code) | `ANTHROPIC_API_KEY` |

## Skills

| Skill | Category | Description |
|-------|----------|-------------|
| `qualify-leads` | data | 7-gate lead qualification pipeline |
| `scrape-linkedin` | data | Scrape post engagers (likers/commenters) |
| `answer-comments` | outreach | Reply to LinkedIn post comments |
| `email-sequence` | content | Generate email drip sequences |
| `visualize-campaigns` | analysis | Campaign dashboards |
| `monthly-campaign-report` | analysis | Cross-campaign intelligence report |
| `orchestrate` | integration | Multi-step workflow from natural language |

## CLI Commands

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
email:create-sequence   Generate email drip sequence
notion:sync             Bidirectional SQLite ↔ Notion sync
notion:bootstrap        Import existing Notion data to SQLite
orchestrate             Natural language → phased skill execution
agent:run               Run background agent immediately
agent:install           Install agent as launchd service
agent:list              List agents with last run status
```

All commands that send or write support `--dry-run`. See [Command Reference](docs/commands.md) for full details, flags, and examples.

## Documentation

| Guide | What it covers |
|-------|---------------|
| [First Run Tutorial](docs/first-run.md) | Step-by-step walkthrough of `start`, plus 3 mini-tutorials |
| [Provider Setup](docs/providers.md) | How to get and configure API keys for each provider |
| [Command Reference](docs/commands.md) | Every CLI command with flags, examples, and expected output |
| [Skills Catalog](docs/skills.md) | All 17 built-in skills with scenarios and decision tree |
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
  cache_ttl_days: 30
```

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

## License

MIT
