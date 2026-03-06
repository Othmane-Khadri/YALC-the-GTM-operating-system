# Day 4 — Systems Architecture Implementation

**Date:** March 6, 2026
**Author:** CTO (Claude)
**The feature:** Transform GTM-OS from a chat + table app into a full GTM operating system with 12 interconnected systems: provider abstraction, MCP interop, skills engine, intelligence layer, human review, web research, campaign management, continuous learning, provider intelligence, nudge engine, and data quality monitoring.

**This is the biggest day of the build.** It implements the entire systems architecture defined in `docs/SYSTEMS_ARCHITECTURE.md`.

---

## How This Day Works

Unlike Days 1-3 (single brief, 3 phases), Day 4 is split into **12 self-contained sub-briefs**. Each sub-brief:
- Lists files to read first
- Defines exact new files to create (with full code)
- Specifies exact modifications to existing files
- Includes numbered verification steps
- Has its own commit message

**Execution:** Run the orchestrator script. It feeds each sub-brief to Claude Code sequentially, runs `pnpm build` after each, auto-commits, and continues to the next.

```bash
cd ~/Desktop/gtm-os
chmod +x tasks/run-day-04.sh
./tasks/run-day-04.sh
```

Resume from a specific point if interrupted:
```bash
./tasks/run-day-04.sh --from 5   # Resume from sub-brief 5
./tasks/run-day-04.sh --only 3   # Run only sub-brief 3
```

---

## Architecture North Star

Read `docs/SYSTEMS_ARCHITECTURE.md` for the full architecture. Three foundational principles:

1. **Intelligence is the product.** Every action generates intelligence. Intelligence is segmented, evidence-backed, bias-checked, and expires.
2. **A campaign is a hypothesis.** Campaigns have a thesis, success metrics, and a verdict (confirmed/disproven/inconclusive). They generate intelligence regardless of outcome.
3. **Skills are execution primitives.** Every recurring task is a standardized, composable, provider-agnostic Skill.

---

## Dependency Graph

```
Layer 1 — Foundation (no dependencies)
  4.1  Provider Registry + StepExecutor interface
  4.5  Intelligence System

Layer 2 — Depends on Layer 1
  4.2  MCP Client + MCPs page              (needs 4.1: ProviderRegistry)
  4.4  Skills Engine                        (needs 4.1: StepExecutor)
  4.6  Human Review + Nudge System          (needs 4.5: Intelligence types)

Layer 3 — Depends on Layers 1-2
  4.3  GTM-OS as MCP Server                 (needs 4.1 + 4.2: provider system)
  4.7  Web Intelligence                     (needs 4.1: provider abstraction)
  4.8  Campaign Manager                     (needs 4.4 + 4.5 + 4.6: skills + intelligence + review)

Layer 4 — Depends on everything above
  4.9  Continuous Learning Loop             (needs 4.5 + 4.6: intelligence + review)
  4.10 Provider Intelligence                (needs 4.1 + 4.5: providers + intelligence)
  4.11 Campaign Optimization (Nudge Engine) (needs 4.5 + 4.6 + 4.8: intelligence + review + campaigns)
  4.12 Data Quality Monitor                 (needs 4.5 + 4.6: intelligence + review)
```

The sub-briefs are numbered in a valid topological order — executing 1→12 sequentially respects all dependencies.

---

## Sub-Briefs Index

| # | File | System | What It Builds |
|---|------|--------|----------------|
| 4.1 | `day-04-sub-01-provider-registry.md` | Provider Registry | `StepExecutor` interface, `ProviderRegistry` singleton, `MockProvider` wrapper, dynamic provider list in planner |
| 4.2 | `day-04-sub-02-mcp-client.md` | MCP Client | `@modelcontextprotocol/sdk`, `McpConnectionManager`, provider bridge, `mcpServers` table, `/mcps` page |
| 4.3 | `day-04-sub-03-mcp-server.md` | MCP Server | GTM-OS as MCP server exposing 5 tools (`search_leads`, `get_framework`, etc.) over SSE |
| 4.4 | `day-04-sub-04-skills-engine.md` | Skills Engine | `Skill` interface, `SkillRegistry`, 4 built-in skills (`find-companies`, `enrich-leads`, `qualify-leads`, `export-data`) |
| 4.5 | `day-04-sub-05-intelligence-system.md` | Intelligence | 8 categories, `Evidence`/`BiasCheck`/`Intelligence` types, `IntelligenceStore`, confidence scoring, prompt injection |
| 4.6 | `day-04-sub-06-human-review.md` | Human Review | `ReviewQueue` class, `/reviews` page, nudge evidence display, one-click actions, priority-based sorting |
| 4.7 | `day-04-sub-07-web-intelligence.md` | Web Intelligence | `WebFetcher` (3-tier: cache → Firecrawl MCP → built-in), `WebResearcher`, insight extraction, `web_cache` table |
| 4.8 | `day-04-sub-08-campaign-manager.md` | Campaigns | Campaign-as-hypothesis model, `CampaignManager`, step execution, approval gates, `/campaigns` page, `propose_campaign` tool |
| 4.9 | `day-04-sub-09-learning-loop.md` | Learning Loop | `SignalCollector`, `PatternDetector`, passive signal capture from all user actions, auto-derive intelligence |
| 4.10 | `day-04-sub-10-provider-intelligence.md` | Provider Intelligence | Per-segment provider stats, smart selection (accuracy × coverage ÷ cost), `provider_stats` table |
| 4.11 | `day-04-sub-11-nudge-engine.md` | Nudge Engine | `CampaignOptimizer`, evidence-backed nudges, A/B test verdicts, projected impact, one-click actions |
| 4.12 | `day-04-sub-12-data-quality.md` | Data Quality | Dedup (fuzzy matching), completeness scoring, anomaly detection, freshness checks, `data_quality_log` table |

---

## New Database Tables (13 total across all sub-briefs)

| Table | Sub-Brief | Purpose |
|-------|-----------|---------|
| `mcp_servers` | 4.2 | MCP server connections (transport, status, config) |
| `intelligence` | 4.5 | Structured intelligence entries with categories + confidence |
| `review_queue` | 4.6 | Unified human review queue (approvals, nudges, escalations) |
| `notification_preferences` | 4.6 | Notification routing config |
| `web_cache` | 4.7 | Fetched web content with TTL |
| `web_research_tasks` | 4.7 | Research task log |
| `campaigns` | 4.8 | Campaign definitions (hypothesis, metrics, verdict) |
| `campaign_steps` | 4.8 | Campaign step execution state |
| `campaign_content` | 4.8 | Content pieces within campaigns |
| `signals_log` | 4.9 | Raw signal capture from all user actions |
| `provider_stats` | 4.10 | Provider execution performance metrics |
| `provider_preferences` | 4.10 | User-set provider preferences per segment |
| `data_quality_log` | 4.12 | Data quality issues with resolution state |

---

## New Pages / Routes

| Route | Sub-Brief | Purpose |
|-------|-----------|---------|
| `/mcps` | 4.2 | Manage MCP server connections |
| `/reviews` | 4.6 | Human review queue |
| `/campaigns` | 4.8 | Campaign list |
| `/campaigns/[id]` | 4.8 | Campaign detail (hypothesis, steps, metrics) |

---

## Sidebar Navigation (Final State After Day 4)

```
Dashboard        (coming soon)
Chat             (active since Day 1)
Tables           (active since Day 3)
Campaigns        (new — 4.8)
Reviews          (new — 4.6, with pending count badge)
Knowledge Base   (active since Day 2)
MCPs             (new — 4.2)
API Keys         (active since Day 3)
```

---

## Verification (End-to-End After All 12)

After all sub-briefs complete, verify the full loop:

1. **Provider system:** Open `/mcps`, verify the page renders. Check that `MockProvider` is registered in the provider registry.
2. **Skills:** In chat, ask to "find 50 SaaS companies in Europe". Claude should reference available skills in the proposal.
3. **Intelligence:** Open the framework — intelligence entries should inject into Claude's system prompt.
4. **Reviews:** Navigate to `/reviews`. Create a test review via API. Approve/reject it.
5. **Campaigns:** In chat, ask to "run a campaign targeting fintech CTOs". Claude should use `propose_campaign` (not just `propose_workflow`).
6. **Data quality:** After a workflow produces results, check that quality checks ran and any issues appear in the review queue.
7. **Build:** `pnpm build` — zero errors.

---

## Commit History (Expected After Full Run)

```
feat: provider-registry (4.1)
feat: mcp-client (4.2)
feat: mcp-server (4.3)
feat: skills-engine (4.4)
feat: intelligence-system (4.5)
feat: human-review (4.6)
feat: web-intelligence (4.7)
feat: campaign-manager (4.8)
feat: learning-loop (4.9)
feat: provider-intelligence (4.10)
feat: nudge-engine (4.11)
feat: data-quality (4.12)
```

---

## If Something Breaks

The orchestrator script stops on build failure, attempts one auto-fix, then stops permanently if it can't resolve. To resume:

```bash
# Check the log to see where it stopped
cat tasks/logs/run.log

# Fix the issue manually, then resume
./tasks/run-day-04.sh --from <failed_step_number>
```

Each sub-brief is designed to be re-runnable — if Claude reads the files and sees the work is already done, it should skip or update rather than duplicate.
