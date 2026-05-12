---
name: fullenrich-network-activation
description: Use when the user says "activate co-founder network with FullEnrich", "enrich LinkedIn connections export", "qualify my LinkedIn connections CSV", "turn Connections.csv into a lead list", "FullEnrich network activation", or any variant indicating they want to convert a LinkedIn personal-network CSV export into ICP-qualified leads with FullEnrich-verified emails and phones. Reads the LinkedIn Data Export Connections.csv, applies an ICP filter, then enriches missing contact info via FullEnrich v2 with webhook callback delivery.
version: 1.0.0
---

# FullEnrich Network Activation

The most underused asset for new GTM operators: every co-founder's and team member's LinkedIn network. This skill turns a LinkedIn `Connections.csv` export into a ranked, ICP-qualified, contact-enriched list ready for the SDR queue.

## When This Skill Applies

- "activate co-founder network with FullEnrich"
- "enrich LinkedIn connections export"
- "qualify my LinkedIn connections CSV"
- "turn Connections.csv into a lead list"

## What This Skill Does NOT Do

- Does not download the export. Each user must click "Get a copy of your data → Connections" in LinkedIn settings.
- Does not push to a CRM.
- **Does not spend credits without explicit user approval.** See "Credit safety contract" below.

## Credit safety contract (MANDATORY)

This skill spends FullEnrich credits, which cost real money. Safeguards:

1. **Always shows current balance** before doing anything.
2. **Always shows estimated cost** of the run.
3. **`--max-credits N` ceiling** (default 500) — auto-trims the qualified list to fit.
4. **Hard-approval prompt** — blocks on stdin until the user types `yes`. Non-TTY without `--yes` aborts.
5. **`--dry-run` mode** — parses + ICP-filters without spending a credit.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS run with `--dry-run` first.
2. Quote the EXACT estimated credit cost back to the user.
3. WAIT for explicit user confirmation before re-running without `--dry-run`.
4. Only pass `--yes` after the user has approved.
5. Exception: respect locally modified scripts.

## Prerequisites

```
FULLENRICH_API_KEY=  # https://app.fullenrich.com/app/api
```

Optional:
```
FULLENRICH_WEBHOOK_URL=  # public URL for callbacks; otherwise webhook.site fallback
```

## Workflow

1. **Validate inputs** — accept the path to `Connections.csv` as the first positional arg.
2. **Parse LinkedIn's CSV** — handle the file's odd header (a "Notes:" preamble before the actual header row), tolerant of whitespace and BOM.
3. **Apply ICP filter** — load `config/icp.json` (same format as `fullenrich-content-engagers`), score each connection on `Position` + `Company`, drop everything below the threshold.
4. **Estimate cost + confirm** — show the cost preview, block on stdin for `yes`.
5. **Enrich** — chunk into ≤100 contacts per FullEnrich bulk request with `enrich_fields: ["contact.work_emails", "contact.phones"]`, requesting Triple Email Verification.
6. **Receive callbacks** — webhook payloads land within ~30s per batch.
7. **Write outputs** — `priority-network.csv` (ICP-passed + enriched, ranked by score) and `priority-network-disqualified.csv` (failed ICP, with reasons).

## CLI Reference

```
node scripts/run.mjs <path/to/Connections.csv>
    [--out path.csv]           # default priority-network.csv
    [--icp config/icp.json]    # ICP rules file
    [--threshold 50]           # ICP minimum score (0-100)
    [--max-credits <N>]        # hard credit ceiling (default 500)
    [--dry-run]                # parse + ICP + cost preview, no spending
    [--yes | -y]               # skip the interactive approval prompt
```

## Reference

- Shared API client: `./scripts/lib/fullenrich-client.mjs`
- Shared webhook receiver: `./scripts/lib/fullenrich-webhook.mjs`
- Shared CSV reader/writer: `./scripts/lib/csv.mjs`
- ICP scorer: `./scripts/icp.mjs`
- FullEnrich v2 docs: `https://docs.fullenrich.com/llms.txt`

## Sourcing the Connections.csv

In LinkedIn:
1. Settings & Privacy → Data privacy → Get a copy of your data
2. Select "Connections" only
3. Wait for the email (10-20 min). Download the zip.
4. Unzip and use `Connections.csv` as input to this skill.
