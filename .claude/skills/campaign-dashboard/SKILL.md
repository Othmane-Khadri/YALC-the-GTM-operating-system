---
name: campaign-dashboard
description: "This skill should be used when the user says 'campaign status', 'show me campaigns', 'visualize campaigns', 'what's the state of campaigns', 'campaign dashboard', 'open campaign view', 'how are outreach campaigns doing visually', 'show campaign pipeline', 'show me the leads for [campaign]', or any variant indicating they want a visual browser-based campaign dashboard."
version: 1.0.0
---

# Campaign Dashboard Skill

Opens the GTM-OS campaign visualization dashboard in the browser — Heyreach/Lemlist-style cards grid with per-lead timelines and variant comparison.

## When This Skill Applies

- "campaign status" / "campaign dashboard"
- "show me campaigns" / "visualize campaigns"
- "what's the state of campaigns"
- "open campaign view" / "campaign pipeline"
- "show me the leads for [campaign name]"
- "how are outreach campaigns doing" (when visual context is implied)

**NOT this skill** (use `campaign-intelligence` instead):
- "campaign report" / "weekly campaign report" → generates a Notion text report
- "compare variants" / "which angle is winning" → text analysis

## What This Skill Does

1. Starts the GTM-OS server (if not already running)
2. Opens the campaign dashboard at `http://localhost:3847/campaigns`
3. Shows campaign cards with live metrics from SQLite
4. Drill into any campaign for per-lead timeline + variant A/B comparison

## What This Skill Does NOT

- Generate Notion reports (that's campaign-intelligence)
- Modify campaigns, leads, or variants
- Send any LinkedIn messages

## Workflow

### Step 1: Start the GTM-OS Dashboard

```bash
npx tsx src/cli/index.ts campaign:dashboard
```

This starts the Hono.js server on port 3847 and opens `/campaigns` in the browser.

### Step 2: If User Wants a Specific Campaign

If the user mentioned a specific campaign name:

1. Query the campaign ID:
```bash
npx tsx -e "
import { db } from './src/lib/db/index.ts';
import { campaigns } from './src/lib/db/schema.ts';
const rows = await db.select({ id: campaigns.id, title: campaigns.title }).from(campaigns);
console.log(JSON.stringify(rows, null, 2));
"
```

2. Open the specific campaign detail page:
```bash
open "http://localhost:3847/campaigns/{campaignId}"
```

### Step 3: Report Back

After opening the dashboard, tell the user:
- The URL that was opened
- A quick summary of what they'll see (number of campaigns, active count, total leads)
- Remind them they can filter by status and search leads in the UI

## Dashboard Pages

| URL | What it shows |
|-----|--------------|
| `/campaigns` | All campaigns as cards with metrics, funnel progress bars, status filters |
| `/campaigns/:id` | Single campaign: variant comparison cards + per-lead horizontal timeline |

## Port

Default: `3847`. If port is in use, pass `--port <number>` to the CLI command.

## Dependencies

- SQLite database with campaign data (`gtm-os.db`)
- No external APIs needed — reads directly from local DB
