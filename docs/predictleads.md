# PredictLeads integration

Company-level intent signals: job openings, financing events, technographics, news events, similar companies. Used for prospect discovery, qualification enrichment, and outbound personalization.

## What you can do

| Task | Skill | CLI |
|---|---|---|
| Pull signals for one company | `predictleads-signals` | `signals:fetch --domain X` |
| Read cached signals locally | `predictleads-signals` | `signals:show --domain X` |
| Find lookalike companies | `predictleads-lookalikes` | `signals:similar --domain X` |
| Enrich a result set in bulk | (called from `prospect-discovery-pipeline`) | `signals:enrich --result-set <id>` |
| Discovery + CMO + outreach drafts | `prospect-discovery-pipeline` | (multi-step skill) |
| Visual dashboard of cached signals | `predictleads-dashboard` | `python3 scripts/predictleads-dashboard.py …` |

## Setup (one time)

1. Get the two API keys from the PredictLeads dashboard. See `TEAM_SETUP.md` at repo root for where the team's shared keys live.
2. Add to `~/.gtm-os/.env`:
   ```
   PREDICTLEADS_API_KEY=<value>
   PREDICTLEADS_API_TOKEN=<value>
   ```
3. Apply the migration to your local SQLite (only needed once on a fresh checkout):
   ```bash
   sqlite3 ~/.gtm-os/gtm-os.db < src/lib/db/migrations/0001_sticky_junta.sql
   # or, interactively: npx drizzle-kit push
   ```
4. Smoke test:
   ```bash
   npx tsx src/cli/index.ts signals:fetch --domain hubspot.com
   ```
   Expect 4 signal types pulled. Cache check: re-run the same command, should print `cache hit` 4×.

## Cost reference

PredictLeads bills 1 credit per API call (with discovery endpoints sometimes per-record). Default monthly quota is 10,000 credits. Check live remaining via the `/api_subscription` endpoint or any `signals:fetch` output.

| Operation | Credits | Notes |
|---|---|---|
| `signals:fetch` (4 default types) | 4 | Per company. Cached 7 days. |
| `signals:fetch --types jobs,funding` | 2 | Restrict types to save credits. |
| `signals:similar` (1 seed) | 1 | Returns up to 50 lookalikes. |
| `signals:enrich --result-set` (10 leads × 4 types) | ≤40 | Cache hits skipped automatically. |
| Re-run within 7 days | 0 | Cache. |

## Architecture (where things live)

```
src/lib/services/
  predictleads.ts                # service singleton (auth, base URL, methods)
  predictleads-storage.ts        # upsert + cache TTL helpers
  predictleads-enrichment.ts     # JSON:API normalizer, enrichDomain, summary builder
  predictleads-bulk.ts           # bulk enrichment for result sets

src/cli/index.ts                 # signals:fetch, signals:show, signals:enrich, signals:similar
                                 # + --enrich-signals flag on leads:qualify

src/lib/db/schema.ts             # companySignals, companySignalFetches tables
src/lib/db/migrations/0001_sticky_junta.sql

src/lib/notion/sync.ts           # syncSignalsToLead — mirror onto Unified Leads DB row

.claude/skills/                  # 4 SKILL.md files for project leads
  predictleads-signals/
  predictleads-lookalikes/
  prospect-discovery-pipeline/
  predictleads-dashboard/

scripts/predictleads-dashboard.py  # HTML generator
```

Tests: `src/__tests__/predictleads*.test.ts` (34 tests across service, storage, normalizer).

## Notion mirror (optional)

`signals:enrich` and `leads:qualify --enrich-signals` write a compact summary onto each Notion lead row, **if** the parent DB has these properties:

- `Signals` — rich_text — short summary like `Series B $30M (2026-04-12) · Hiring 3 sales · Uses Salesforce`
- `Signals Updated At` — date

For Earleads' Unified Leads DB, the data source ID is `56e04a3e-a757-4714-b328-1e5910a80bb1`. Add the columns once via Notion's UI or the `notion-update-data-source` MCP tool. Without them, the writes silently no-op.

## Tenant config

Earleads tenant opts in via `~/.gtm-os/tenants/earleads/adapters.yaml`:

```yaml
signals:
  provider: predictleads
  enabled: true
  cacheTtlDays: 7
  autoEnrichOnQualify: true
```

`autoEnrichOnQualify` makes `leads:qualify` automatically run signal enrichment as a post-step.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `PREDICTLEADS_API_KEY must be set` | Add both vars to `~/.gtm-os/.env`. They are issued together on the same PredictLeads page. |
| `signals:show` shows blank headlines | News uses `summary` not `title`. Tech and similar_company need the relationships fix in the normalizer. Re-fetch with `--no-cache` if cache predates the fix. |
| HTTP 402 from API | Quota exhausted. Check `/api_subscription`. Wait until the cycle reset or upgrade plan. |
| Migration won't apply, drizzle-kit asks for confirmation | Use `sqlite3 ~/.gtm-os/gtm-os.db < src/lib/db/migrations/0001_sticky_junta.sql` for non-interactive apply. |
| Crustdata can't find a CMO at `domain.com` | Some companies' Crustdata domain is their ATS or marketing host (e.g., `hubs.li`). Fall back to searching by `current_employers.name` substring. |

## Source

Built April 29–30, 2026. Tagged `v0.9.0`. Tests at `src/__tests__/predictleads*.test.ts`.
