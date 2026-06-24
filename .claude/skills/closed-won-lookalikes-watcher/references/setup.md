# Setup — closed-won-lookalikes-watcher

This walkthrough covers the first interactive run that seeds the
`.config.json` file, plus the schedule install.

## Prerequisites

Export these in your shell (or `~/.zshenv` / `~/.bashrc`):

```bash
export HUBSPOT_API_KEY="..."          # private app token, deals:read scope
export PREDICTLEADS_API_KEY="..."     # similar_companies endpoint
export FULLENRICH_API_KEY="..."       # bulk enrich
# Optional, only if Slack delivery is webhook mode
export SLACK_WEBHOOK_URL="..."
```

Verify each is loaded:

```bash
for v in HUBSPOT_API_KEY PREDICTLEADS_API_KEY FULLENRICH_API_KEY; do
  if [ -n "${!v}" ]; then echo "$v: set"; else echo "$v: MISSING"; fi
done
```

The skill never echoes the values. SETUP MODE only checks the exit code
of `printenv`.

## Step 1: HubSpot pipeline stage

Open HubSpot → Settings → Pipelines → Sales → Stages. Find the "Closed
Won" stage and copy its **internal id** (NOT the display label). For
most accounts this is `closedwon`; some teams use `closedwon` per
pipeline or a custom id like `appointmentscheduled_won`.

If you're not sure, the manifest at
`providers/manifests/crm-list-closed-won/hubspot.yaml` ships with
`closedwon` and the smoke test runs against that value.

## Step 2: First interactive run

```bash
npx tsx src/cli/index.ts skill:run --skill closed-won-lookalikes-watcher
```

Answer the questions:

| # | Question | Persist as | Default |
|---|---|---|---|
| 1 | HubSpot `dealstage` value | `hubspot.dealstage` | `closedwon` |
| 2 | Lookback window in days | `lookback_days` | 7 |
| 3 | Max anchor domains per run | `max_anchor_domains` | 10 |
| 4 | Weekly enrichment budget (USD or `unlimited`) | `budget_usd` | 25 |
| 5 | Max lookalikes in digest (number or `auto`) | `max_n` | `auto` |
| 6 | FullEnrich cost per enrichment in USD | `cost_per_enrichment_usd` | 0.30 |
| 7 | Slack delivery mode | `slack_delivery.mode` | `mcp_user` |
| 8 | Slack target (user ID / channel ID / env var name) | `slack_delivery.target` | (none) |
| 9 | Final confirmation before writing config | (none) | (none) |

After step 6 the skill prints the derived effective top-N and the
estimated weekly cost so you can sanity-check before persisting:

```
Effective top-N this week: {N}.
Weekly cost estimate: ${N * cost_per_enrichment_usd}.
```

Rules used to derive the effective N:

- `budget_usd = unlimited` and `max_n = auto` -> 50 (legacy default).
- `budget_usd = unlimited` and `max_n = number` -> `max_n`.
- `budget_usd = number` and `max_n = auto` -> `floor(budget / cost)`, capped at 200.
- `budget_usd = number` and `max_n = number` -> `min(max_n, floor(budget / cost))`.

The default `cost_per_enrichment_usd` is 0.30, which matches the
sensible FullEnrich price for the bulk-enrich endpoint we use. Tenants
on a custom FullEnrich plan should override this value to match their
actual unit cost so the budget math stays honest.

On success it prints:

```
Setup complete. Run me again to generate this week's digest.
```

The skill writes `.claude/skills/closed-won-lookalikes-watcher/.config.json`.
The folder's `.gitignore` already excludes this file.

## Step 3: Install the schedule

```bash
cp configs/agents/closed-won-lookalikes-watcher.yaml \
   ~/.gtm-os/agents/closed-won-lookalikes-watcher.yaml
npx tsx src/cli/index.ts agent:install --agent closed-won-lookalikes-watcher
```

`agent:install` registers a launchd job (macOS) at the schedule defined
in the YAML — Monday 09:00 local, `maxRetries: 1`, `timeoutMs:
1800000`. Confirm with:

```bash
npx tsx src/cli/index.ts agent:list
```

The agent should appear in the list with no prior runs.

## Step 4: Smoke test

Run the agent once manually with the configured pipeline and Slack
target:

```bash
npx tsx src/cli/index.ts agent:run --agent closed-won-lookalikes-watcher
```

You should see:

1. A HubSpot deals call with `since = today - lookback_days`.
2. One `IntelligenceStore.add()` write with `category: 'icp'` and
   `confidence: 'hypothesis'`.
3. One `find-lookalikes` invocation per unique anchor domain.
4. A FullEnrich bulk enrichment + poll loop.
5. A dedup pass via `buildSuppressionSet`.
6. A Slack message landing at the configured target.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Empty digest (`No closed-won deals last week`) | Expected if no deals closed in the window. Confirm `lookback_days` and `hubspot.dealstage`. |
| HubSpot 401 | Re-export `HUBSPOT_API_KEY` and re-run. Confirm the private app has `crm.objects.deals.read`. |
| PredictLeads rate limit | Lower `max_anchor_domains` in `.config.json`. |
| FullEnrich poll timeouts | The service polls up to 5 minutes. If consistently slow, run manually first. |
| Slack 404 (webhook) | Check `$SLACK_WEBHOOK_URL`. |
| Slack `channel_not_found` (mcp mode) | Re-resolve via `slack_search_users` / `slack_search_channels` and update `.config.json`. |

## Updating the schedule

Edit the YAML, re-copy, re-run `agent:install`. The script is
idempotent.

```bash
cp configs/agents/closed-won-lookalikes-watcher.yaml \
   ~/.gtm-os/agents/closed-won-lookalikes-watcher.yaml
npx tsx src/cli/index.ts agent:install --agent closed-won-lookalikes-watcher \
  --hour 9 --minute 0
```
