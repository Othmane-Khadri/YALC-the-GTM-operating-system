---
name: import-leads
description: "Import a batch of leads from CSV, JSON, or a Notion DB into the local SQLite database without running the qualification pipeline. Use when the user says 'just import this CSV', 'load these leads without qualifying', 'bulk import this file', 'add these prospects to the DB', or 'pull this Notion DB into YALC'. Side-effecting — writes rows into local SQLite."
version: 1.0.0
---

# Import Leads

I'll wrap `leads:import`. Take an input file or Notion DB id, run the import, and surface the result-set id.

## When This Skill Applies

- "just import this CSV"
- "load these leads without qualifying"
- "bulk import this file"
- "add these prospects to the DB"
- "pull this Notion DB into YALC"

**NOT this skill** (use `qualify-leads` instead):
- "qualify these leads" / "score this list" — that runs the 7-gate pipeline. This skill is import only.

**NOT this skill** (use `scrape-post-engagers` instead):
- "scrape engagers off this LinkedIn post" — that produces a result set from Unipile, not from a file.

## Workflow

### Step 0 — Ask for input source + path

> "What's the input source — CSV, JSON, or Notion DB? And what's the path or DB id?"

### Step 1 — Validate (file exists / Notion id format)

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts leads:import --source <type> --input <path>
```

### Step 3 — Parse output

CLI emits row count + result-set id.

### Step 4 — Render

### Step 5 — Offer follow-ups

> "Want me to (a) qualify these via `qualify-leads --result-set <id>`, (b) launch a campaign on the imported leads?"

## Notes

- CSV expected columns: at least one of `email`, `linkedin_url`. Other columns are kept as custom fields.
- Notion DB requires a 32-char hex id. The CLI introspects schema and maps obvious columns.
