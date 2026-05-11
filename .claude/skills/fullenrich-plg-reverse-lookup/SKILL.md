---
name: fullenrich-plg-reverse-lookup
description: Use when the user says "set up FullEnrich reverse lookup for trial signups", "PLG enrichment webhook", "identify free trial signups via FullEnrich", "reverse email lookup for these signups", "who are these emails", "deploy a hosted webhook for trial signups", or any variant indicating they want to identify the person and company behind a signup email. Two install paths: (a) CLI batch over a CSV/JSON of recent signups, (b) hosted webhook that receives signup events live, runs FullEnrich reverse lookup, and outputs the enriched record as a JSONL log plus an optional generic forward webhook the user wires to whatever downstream they run.
version: 1.0.0
---

# FullEnrich PLG Reverse Lookup

When a free trial signup hits your product, you have ~5 minutes before they cool off. This skill turns a signup email into an identified person + LinkedIn profile + company in real time, using FullEnrich's reverse email lookup.

Two install paths in one repo:
- **Path A (CLI batch):** point it at a `signups.csv`, get an enriched JSON back. Cron-friendly.
- **Path B (hosted webhook):** deploy the included `api/` folder to any Vercel-compatible host. Receives POST `{ email }`, runs reverse lookup, writes the enriched record to a JSONL log and optionally forwards it to any URL you specify. Pure FullEnrich output; wire downstream to whatever stack you run.

## When This Skill Applies

- "set up FullEnrich reverse lookup for trial signups"
- "PLG enrichment webhook"
- "who are these emails"
- "identify free trial signups via FullEnrich"
- "deploy a Vercel webhook for trial signups"

## What This Skill Does NOT Do

- Does not capture signup events itself. You wire your product's signup hook (your backend, your auth provider, your payment processor, whatever fires when a new user is created) to either path A's CSV or path B's webhook URL.
- Does not write outreach copy.
- **Does not spend credits without explicit user approval (CLI mode).** See "Credit safety contract" below.

## Credit safety contract (MANDATORY)

This skill spends FullEnrich credits, which cost real money. Safeguards (CLI mode):

1. **Always shows current balance** before doing anything.
2. **Always shows estimated cost** of the run.
3. **`--max-credits N` ceiling** (default 100) — auto-trims the email list to fit.
4. **Hard-approval prompt** — blocks on stdin until the user types `yes`. Non-TTY without `--yes` aborts.
5. **`--dry-run` mode** — parses + dedupes without spending a credit.

**Webhook mode is different.** It runs unattended in production. Built-in protections there:

- `MAX_CREDITS_PER_DAY` env var (default 200) — webhook short-circuits with HTTP 429 once exceeded, written to a `lookup-counter.json` shadow file in `/tmp` for cold-start safety.
- `WEBHOOK_DRY_RUN=1` env var — webhook validates payload and logs intent but does NOT call FullEnrich. Use this for the first 24 hours after deploy.
- Each webhook invocation logs the running daily total to stdout. Set up a Vercel log alert if you want stricter control.

**When Claude invokes the CLI on a user's behalf:**
1. ALWAYS run with `--dry-run` first.
2. Quote the EXACT estimated credit cost back to the user.
3. WAIT for explicit user confirmation before re-running without `--dry-run`.
4. Only pass `--yes` after the user has approved.
5. Exception: respect locally modified scripts.

## Prerequisites

```
FULLENRICH_API_KEY=  # https://app.fullenrich.com/app/api
```

For webhook mode (Path B):
```
MAX_CREDITS_PER_DAY=200    # hard daily credit ceiling
WEBHOOK_DRY_RUN=1          # set to 1 for first 24h after deploy
PLG_LOG_PATH=              # optional, default /tmp/plg-enriched.jsonl
FORWARD_WEBHOOK_URL=       # optional, POSTs the enriched record to any URL
```

## Path A — CLI batch

```
node scripts/batch.mjs --input signups.csv --out enriched.json
    [--max-credits <N>]    # hard credit ceiling (default 100)
    [--dry-run]            # dedupe + cost preview, no spending
    [--yes | -y]           # skip the interactive approval prompt
```

The input file can be CSV (with an `email` column) or JSON (array of `{ email }` objects).

## Path B — Hosted webhook

```
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-plg-reverse-lookup
vercel deploy
```

Then POST to `https://<your-deploy>.vercel.app/api/webhook` with body `{ email: "user@example.com", custom?: { ... } }`. The endpoint:

1. Calls FullEnrich `POST /contact/reverse/email/bulk` with one email
2. Receives the webhook callback (within ~30s) via a separate `/api/fullenrich-callback` endpoint
3. Appends the enriched record to a JSONL log file. Optionally POSTs it to a forwarding URL set in `FORWARD_WEBHOOK_URL`. Pipe the log or the forward URL to whatever downstream stack you run.

## Reference

- Shared API client: `./scripts/lib/fullenrich-client.mjs`
- Shared webhook receiver: `./scripts/lib/fullenrich-webhook.mjs`
- FullEnrich v2 docs: `https://docs.fullenrich.com/llms.txt`
- Reverse lookup endpoint: `POST /api/v2/contact/reverse/email/bulk`
