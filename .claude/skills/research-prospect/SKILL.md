---
name: research-prospect
description: "Run ad-hoc web research on a prospect (company URL or person) — Firecrawl scrapes the marketing site, key pages (pricing, careers, blog), and surfaces a brief. Read-only. Use when the user says 'research this prospect', 'tell me about [company]', 'do a deep dive on [domain]', 'pull a brief on this lead', or 'crawl the marketing site for [name]'. Side-effecting on the Firecrawl side (API call), no local DB writes."
version: 1.0.0
---

# Research Prospect

I'll wrap `research`. Take a URL, run a Firecrawl scrape against the canonical pages, and produce a brief.

## When This Skill Applies

- "research this prospect"
- "tell me about [company]"
- "do a deep dive on [domain]"
- "pull a brief on this lead"
- "crawl the marketing site for [name]"

**NOT this skill** (use `enrich-with-signals` instead):
- "pull buying signals" — that's structured PredictLeads data, not narrative research.

**NOT this skill** (use `personalize-message` with `--enrich` instead):
- "personalize a message for them" — that auto-pulls research as part of the personalization.

## Workflow

### Step 0 — Ask for the URL

> "What's the company URL or LinkedIn profile?"

### Step 1 — Validate URL

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts research --url <url>
```

### Step 3 — Parse output

CLI emits a brief markdown summary + key facts table.

### Step 4 — Render the brief verbatim

Don't summarize the summary — pass through what the CLI returns.

### Step 5 — Offer follow-ups

> "Want me to (a) personalize a message for someone at this company via `personalize-message`, (b) check buying signals via `enrich-with-signals`?"

## Notes

- Requires `FIRECRAWL_API_KEY` in `~/.gtm-os/.env`.
- Firecrawl call cost varies by depth (default: 1 credit per ~5 pages).
- Read-only on the local DB — research output is rendered in chat, not persisted.
