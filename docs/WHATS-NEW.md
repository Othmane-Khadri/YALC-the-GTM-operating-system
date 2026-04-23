# What's New — Clay Gap Release (2026-04-22)

If you already have GTM-OS installed, here's what changes when you pull.

## TL;DR

- **Your existing commands still work.** `leads:import`, `leads:qualify`, `campaign:create`, `campaign:track`, `orchestrate`, `personalize` — same interface, better guts.
- **One behavior shift:** `leads:qualify` is ~15% stricter because it catches more duplicates automatically.
- **10 new capability areas** were added. You opt in per command.
- **~285 new tests.** Codebase test count went from ~200 to ~485.

---

## Update in one command

From your existing GTM-OS directory:

```bash
npx tsx src/cli/index.ts update
```

That pulls the latest, reinstalls dependencies, and keeps your `~/.gtm-os/config.yaml` + API keys intact.

After updating, run:

```bash
npx tsx src/cli/index.ts doctor
```

You'll see checks for 7 providers (was 4) plus any MCP providers you've configured.

---

## Behavior changes in existing commands

### `leads:qualify` — Gate 0 dedup got smarter

**Before:** dedup only caught exact matches on `provider_id` or `linkedin_url`.

**After:** four matchers run automatically —
1. Exact email (case-insensitive)
2. LinkedIn URL with normalization (query params, trailing slashes, `/pub/` vs `/in/`)
3. Fuzzy name+company via Dice coefficient (configurable threshold, default 0.8)
4. Domain+title similarity (same email domain + similar job title)

Plus it checks against **active campaign leads + replied leads + demo-booked leads**, so the "skip if replied" rule is now enforced automatically across every campaign.

**What you'll see:** fewer leads qualifying on re-runs. A list that produced 400 qualified leads last month may now return 340, with the rest flagged as duplicates of existing outreach.

**Escape hatch:** `leads:qualify --result-set <id> --no-dedup` restores the old behavior.

**Opt-in:** `leads:qualify --slack-confirm` posts ambiguous matches (60-80% confidence) to Slack for human decision.

### Error output is cleaner

Errors from providers now show a one-line diagnosis:

```
Crustdata: rate limited (429). Wait 60s and retry.
```

Instead of a 40-line stack trace.

For debugging, add `--verbose` to any command to see the full stack.

### `doctor` checks more

- 7 built-in providers (added Crustdata, Instantly, FullEnrich — was Anthropic, Unipile, Firecrawl, Notion only)
- Any MCP providers you've configured in `~/.gtm-os/mcp/*.json`

### DB migration runs on first launch

One-time: creates the `signal_watches` table. Nothing for you to do.

---

## New capabilities (opt-in)

All new. None of these change existing behavior.

### 1. MCP-based provider plugins — `provider:*`

Plug any MCP-compatible data source directly. Templates included for HubSpot, Apollo, People Data Labs, ZoomInfo.

```bash
provider:list                       # see all providers with status
provider:add --mcp hubspot          # add from a config template
provider:test hubspot               # check connection
provider:remove hubspot             # remove
```

Config files live at `~/.gtm-os/mcp/*.json`.

### 2. Markdown-based skills — `skills:create`

Write a skill as a `.md` file with frontmatter. No TypeScript required.

```bash
skills:create --format markdown
```

Wizard asks for name, description, inputs, provider. Writes a working skill to `~/.gtm-os/skills/`. Appears in the skill list alongside built-ins.

Examples in `configs/skills/`: `research-company.md`, `enrich-email.md`, `score-lead.md`.

### 3. Signal detection — `signals:*`

Watch target companies for job changes, hiring surges, funding rounds, news mentions. Fire an action when something changes.

```bash
signals:watch --companies acme.com,globex.com
signals:list
signals:detect
signals:triggers set --signal hiring_surge --action enrich
```

Four detectors shipped: `detect-job-change`, `detect-hiring-surge`, `detect-funding`, `detect-news` (see `configs/skills/`).

Agent template: `configs/agents/signal-detector.yaml` (daily 09:00 schedule).

### 4. Workflow chains — `pipeline:*`

Declarative YAML pipelines. Chain find → enrich → qualify → export with conditions and checkpoints.

```bash
pipeline:list
pipeline:create --name my-pipeline
pipeline:run --file configs/pipelines/find-enrich-qualify.yaml --dry-run
pipeline:run --file configs/pipelines/find-enrich-qualify.yaml
pipeline:resume --name my-pipeline   # if it was interrupted
pipeline:status --name my-pipeline
```

Condition DSL supports `==`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `exists`, `AND`, `OR`. No `eval()`.

Three example pipelines in `configs/pipelines/`.

### 5. CRM integration (MCP-first) — `crm:*`

Push qualified leads directly to HubSpot, Salesforce, Pipedrive — no CSV export/import loop.

```bash
crm:setup --provider hubspot        # wizard: MCP connection + field mapping
crm:import --provider hubspot       # import leads from CRM
crm:push --result-set <id>          # push qualified leads to CRM
crm:sync                            # bidirectional sync
crm:status
crm:verify                          # drift detection if CRM schema changes
```

Field mappings stored as YAML at `~/.gtm-os/crm/*.yaml`. Editable by hand.

### 6. AI research agent — `research`

Answer any question about a company, person, or topic with an evidence chain.

```bash
research --question "What CRM does Acme use?" --target acme.com
```

Output: answer + confidence score + source URLs + extracted evidence. Web cache skips re-scraping within 7 days.

### 7. Live dedup + suppression — `leads:dedup`, `leads:suppress`

Run dedup standalone:

```bash
leads:dedup --result-set <id> --strategy all --slack-confirm
leads:suppress --source hubspot
leads:suppress --source csv --file blocklist.csv
```

Suppression list auto-includes active campaign leads, replied leads, and your blocklist.

### 8. Export adapters — `leads:export`

Multi-destination export in one command:

```bash
leads:export --result-set <id> --destination csv
leads:export --result-set <id> --destination json
leads:export --result-set <id> --destination google-sheets --sheet-id <id>
leads:export --result-set <id> --destination webhook --url https://...
leads:export --result-set <id> --destination lemlist
leads:export --result-set <id> --destination apollo
leads:export --result-set <id> --destination woodpecker
```

Sequencer formats (Lemlist/Apollo/Woodpecker) output the exact column names those tools expect.

### 9. Claude Code context rules

`.claude/rules/` contains four files (`enrichment.md`, `qualification.md`, `campaigns.md`, `skills.md`). When you run Claude Code inside the repo, it auto-loads the right rules for whichever subsystem you're editing.

---

## Under the hood — code improvements

Not user-facing commands, but things that got sharper:

- **Qualification pipeline** — Gate 0 went from a 2-field match to a pluggable 4-matcher engine.
- **Orchestrator transforms** — replaced 4 hardcoded pairs with a generic field-mapping engine. New skill combos work without editing the core.
- **Provider registry** — priority-aware resolution (builtin > mcp > mock), dynamic MCP registration at boot, no silent fallback to mock.
- **Error handler** — global boundary catches all CLI commands (previously ~20 bare handlers could crash with stack traces).
- **Skills registry** — markdown and TypeScript skills register through the same path, indistinguishable to downstream code.
- **Importers** — CRM sources (hubspot/salesforce/pipedrive) routed through the existing importer abstraction.
- **CI** — `.github/workflows/test.yml` runs typecheck + full test suite on every PR.

---

## Recommended first hour after updating

```bash
# 1. Update
npx tsx src/cli/index.ts update

# 2. Check health
npx tsx src/cli/index.ts doctor

# 3. See what's available
npx tsx src/cli/index.ts provider:list
npx tsx src/cli/index.ts pipeline:list

# 4. Try a research query
npx tsx src/cli/index.ts research --question "What tech stack does <prospect>.com use?" --target <prospect>.com

# 5. Run a dry-run pipeline to see the new flow
npx tsx src/cli/index.ts pipeline:run --file configs/pipelines/find-enrich-qualify.yaml --dry-run
```

---

## Rollback

If something breaks, the previous state is preserved on the `main-pre-gap-plan-2026-04-22` branch:

```bash
git fetch
git checkout main-pre-gap-plan-2026-04-22
pnpm install
```

You'll be back on the pre-release state. Report the issue and we'll fix forward.
