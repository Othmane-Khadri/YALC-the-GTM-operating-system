# YALC — The Open-Source GTM Operating System

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

> AI plans your campaigns, qualifies your leads, and learns from every interaction.

YALC is an open-source, AI-native operating system for running any GTM campaign. CLI-first. Intelligence compounds from every interaction.

## Quick Start

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd gtm-os
pnpm install
cp .env.example .env.local  # Add your API keys

# Initialize your GTM framework
pnpm cli -- setup

# Run your first qualification (dry-run)
pnpm cli -- leads:qualify --source csv --input data/leads/sample.csv --dry-run

# Create a campaign
pnpm cli -- campaign:create --title "Q2 Outbound" --hypothesis "VP Eng responds to pain-point messaging"

# Track campaign progress
pnpm cli -- campaign:track --dry-run
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
| **Firecrawl** | Web scraping, search | `FIRECRAWL_API_KEY` |
| **Notion** | Database sync, page management | `NOTION_API_KEY` |
| **FullEnrich** | Email/phone enrichment | `FULLENRICH_API_KEY` |
| **Anthropic** | AI planning, qualification, personalization | `ANTHROPIC_API_KEY` |

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
setup                   Check API keys and provider connectivity
onboard                 Build GTM framework from profile/website
agent:run               Run background agent immediately
agent:install           Install agent as launchd service
agent:list              List agents with last run status
```

All commands that send or write support `--dry-run`.

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
