---
name: run-competitive-intel
description: "Pull competitive intelligence on a competitor — pricing, positioning, recent changes, customer stories — via the competitive-intel CLI. Use when the user says 'analyze this competitor', 'pull competitive intel on [company]', 'compare us to [competitor]', 'what's [company] doing differently', or 'audit [competitor] pricing'. Side-effecting — calls Firecrawl + Anthropic, writes to local cache."
version: 1.0.0
---

# Run Competitive Intel

I'll wrap `competitive-intel`. Take a competitor URL, run the analysis pipeline, and surface the comparative brief.

## When This Skill Applies

- "analyze this competitor"
- "pull competitive intel on [company]"
- "compare us to [competitor]"
- "what's [company] doing differently"
- "audit [competitor] pricing"

**NOT this skill** (use `research-prospect` instead):
- "research this company" — that's a brief on a prospect, not a comparative analysis.

## Workflow

### Step 0 — Ask for the competitor URL

> "What's the competitor URL?"

### Step 1 — Validate URL

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts competitive-intel --competitor <url>
```

### Step 3 — Parse output

CLI emits a markdown comparative brief: their positioning vs. ours, pricing diff, customer-story angles, recent changes detected.

### Step 4 — Render the brief verbatim

### Step 5 — Offer follow-ups

> "Want me to (a) draft a sales battle card from this, (b) personalize an outbound message that addresses their positioning?"

## Notes

- Requires `FIRECRAWL_API_KEY` + `ANTHROPIC_API_KEY`.
- Reads our own positioning from `~/.gtm-os/company_context.yaml`.
- Read-only on the user-data DB; writes to a competitive-intel cache.
