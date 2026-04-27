# YALC GTM-OS — Claude Code Rules

## Project Identity
Open-source AI-native GTM operating system. Stack: Next.js 14, Tailwind, Drizzle + SQLite, Jotai, Anthropic SDK.

## Directory Structure
- `src/cli/index.ts` — CLI entry point, all commands registered here
- `src/lib/services/` — external integrations (Crustdata, Unipile, FullEnrich, Instantly, Notion, Firecrawl, Slack)
- `src/lib/qualification/` — 7-gate lead qualification pipeline
- `src/lib/campaign/` — campaign creation, tracking, scheduling, intelligence
- `src/lib/context/` — context adapters (e.g., markdown-folder for reading external knowledge bases)
- `src/lib/memory/` — tenant memory store, embeddings, retrieval, dream cycle
- `src/lib/framework/` — GTM framework derivation from company context
- `src/lib/agents/` — background agents, launchd integrations
- `src/app/` — Next.js web UI (chat, onboarding)
- `~/.gtm-os/` — per-tenant config, framework YAML, adapters
- `docs/` — architecture, commands, troubleshooting

## CLI
```
npx tsx src/cli/index.ts <command> [options]
```
Env loaded from `.env.local`. Use `--tenant <slug>` or `GTM_OS_TENANT` env var for multi-tenant (default: `default`).

## Security
- **NEVER display API keys, tokens, or secrets from `.env.local` in chat output.** Mask all credentials.

## Commit Rules
- Public repo — use generic, descriptive commit messages. Never use prompt-like or task-specific messages.

## Context Loading Map

Path-specific rules live in `.claude/rules/`. Claude Code auto-loads the relevant rule file when working in a matching directory.

| Rule File | Covers | Key Context |
|-----------|--------|-------------|
| `.claude/rules/enrichment.md` | `src/lib/enrichment/`, `src/lib/providers/` | Provider registry, credit tracking, StepExecutor interface |
| `.claude/rules/qualification.md` | `src/lib/qualification/` | 7-gate pipeline order, intelligence injection, gate configs |
| `.claude/rules/campaigns.md` | `src/lib/campaign/` | Message validation, rate limits, sequence timing, A/B testing |
| `.claude/rules/skills.md` | `src/lib/skills/` | Skill interface, RowBatch generator pattern, registry |

**Adding new rules:** Create a `.md` file in `.claude/rules/` with an "Applies to" header listing the directories it covers, a "Context to Load" section with key files to read, and "Hard Rules" for non-negotiable constraints.

## Persisting User Preferences

When the user expresses a durable rule, convention, or preference mid-session — phrases like "always X", "from now on", "we never Y", "remember that...", "for this project we..." — append it to the most specific matching file before continuing the task.

| What user said about | Where to save |
|---|---|
| Skill conventions, naming, validation, run patterns | `.claude/rules/skills.md` |
| Provider choices, MCP setup, credit policy, rate limits | `.claude/rules/enrichment.md` |
| Qualification gate behavior, ICP scoring, exclusion rules | `.claude/rules/qualification.md` |
| Campaign timing, message patterns, A/B testing rules | `.claude/rules/campaigns.md` |
| Repo-wide conventions, workflow, tooling | `CLAUDE.md` (this file), inserted under the most relevant section |

Write the rule in durable, generic wording — as a project rule, not a transcript. Bad: "User just said don't use HubSpot." Good: "Provider preference: do not configure HubSpot for this tenant."

If the user's preference doesn't match any of the above buckets, ask once: "Should I save this as a project rule in `<file>`?" Default to yes.

If the rule contradicts an existing line in the file, replace the old line and add a one-line `(updated YYYY-MM-DD)` annotation.

## Persisting Runtime Context (the GTM brain)

Project rules above describe how Claude Code should behave. Runtime context is different — it describes the user's company, ICP, voice, and outreach assets, and lives under `~/.gtm-os/`. When the user shares context mid-session that should land in the GTM brain, route the change through the preview/commit flow, never write directly to the live file.

| When user says... | Save to (in `_preview/`) |
|---|---|
| "my voice is...", "tone should be..." | `voice/tone-of-voice.md` |
| "my ICP is...", "we sell to..." | `company_context.yaml` (`icp.*` fields) |
| "qualify a lead like X", "score this kind of lead..." | `qualification_rules.md` |
| "my outreach should...", "connect note should say..." | `campaign_templates.yaml` |
| "monitor this signal", "watch for X" | `search_queries.txt` |
| "we compete with X" | `company_context.yaml` (`icp.competitors`) |
| "our segment is...", "primary segment description..." | `icp/segments.yaml` |

Hard rule: **runtime context modifications must go through `_preview/` and a commit step.** Never write directly to `~/.gtm-os/<live-file>`. Use `yalc-gtm start --regenerate <section>` to refresh a section, then `yalc-gtm start --commit-preview` (optionally with `--discard <section>`) to promote it. If the user asks for an immediate edit, write the change into `_preview/` and tell them to review + commit.

For per-tenant runs (`--tenant acme`), substitute `~/.gtm-os/tenants/acme/_preview/<file>`.

## Second Brain Context
For Earleads-specific client context (ICP, playbooks, battlecards), read from the Second Brain workspace configured as `additionalDirectory`. Client files: `01_Projects/Clients/Active/{ClientName}/`.
