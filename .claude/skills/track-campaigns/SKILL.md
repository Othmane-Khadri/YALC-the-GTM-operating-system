---
name: track-campaigns
description: "Poll Unipile / Instantly for the status of running campaigns, advance sequence steps that are due, and sync results to Notion. Run this on a cadence (cron / launchd) or manually after staging a campaign. Use when the user says 'track campaigns', 'advance the sequences', 'check campaign progress', 'poll for replies', or 'sync replies to Notion'. Side-effecting — calls Unipile/Instantly, writes to SQLite + Notion."
version: 1.0.0
---

# Track Campaigns

I'll wrap `campaign:track`. Run the polling cycle, advance any sequence steps that are due, and surface the per-campaign status delta.

## When This Skill Applies

- "track campaigns"
- "advance the sequences"
- "check campaign progress"
- "poll for replies"
- "sync campaign status to Notion"

**NOT this skill** (use `launch-linkedin-campaign` instead):
- "launch a campaign" — that's the create+stage flow.

**NOT this skill** (use `answer-linkedin-comments` instead):
- "reply to LinkedIn comments" — that's per-thread engagement, not campaign-level tracking.

## Workflow

### Step 0 — No input needed (or ask for `--campaign-id <id>` if user wants a single campaign)

### Step 1 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts campaign:track
```

Optional: `--campaign-id <id>` to scope to one campaign.

### Step 2 — Parse output

CLI emits per-campaign status delta: messages sent, replies detected, sequence steps advanced, errors.

### Step 3 — Render

### Step 4 — Offer follow-ups

> "Want me to (a) personalize follow-ups for hot replies via `personalize-message`, (b) generate the weekly campaign report via `campaign:report`?"

## Notes

- Best run on cron: every 15 min during business hours.
- Replies appear in Notion within ~2 min of posting (Unipile webhook latency).
- The CLI is idempotent — running it twice in quick succession is safe (advances nothing if no time has elapsed).
