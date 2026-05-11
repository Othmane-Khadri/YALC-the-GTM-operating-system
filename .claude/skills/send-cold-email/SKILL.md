---
name: send-cold-email
description: "Send a cold email campaign or single message via the configured email provider (Instantly by default), optionally pre-drafting the sequence. Use when the user says 'send a cold email to this list', 'fire the email sequence', 'launch the email campaign', 'send the drip sequence', or 'email these qualified leads'. Side-effecting — calls Instantly API and writes to local SQLite + Notion."
version: 1.0.0
---

# Send Cold Email

I'll wrap two CLIs — `email:create-sequence` (drafts the sequence) and `email:send` (fires it). Both side-effecting → both shell-out.

## When This Skill Applies

- "send a cold email to this list"
- "fire the email sequence"
- "launch the email campaign"
- "send the drip sequence"
- "email these qualified leads"

**NOT this skill** (use `launch-linkedin-campaign` instead):
- "launch a LinkedIn campaign" — that's the connect+DM flow on LinkedIn.

**NOT this skill** (use `personalize-message` instead):
- "personalize a single email" — single per-lead variant, not bulk send.

## Workflow

### Step 0 — Ask for inputs

> "Which result set, what subject + intro, how many touches?"

### Step 1 — Validate (result set exists, intro non-empty)

### Step 2 — Shell out to `email:create-sequence`

```bash
npx tsx src/cli/index.ts email:create-sequence --result-set <id> --subject "<subject>" --intro "<intro>"
```

(Verify exact flags via `--help`.)

### Step 3 — Render the drafted sequence + ask for approval

> "Drafted N messages across M touches. Send? (yes / preview only / cancel)"

### Step 4 — On yes, shell out to `email:send`

```bash
npx tsx src/cli/index.ts email:send --sequence-id <id>
```

### Step 5 — Render send result + offer follow-ups

> "Want me to (a) track replies via `track-campaigns`, (b) personalize follow-ups for hot replies?"

## Notes

- Requires `INSTANTLY_API_KEY` (or whatever email provider is configured).
- Default cadence: day 0, day 3, day 7, day 14.
- The CLI enforces sending limits per the user's email accounts (Instantly handles deliverability).
