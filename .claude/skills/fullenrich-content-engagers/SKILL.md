---
name: fullenrich-content-engagers
description: Use when the user says "enrich people who engaged with this post", "qualify post engagers with FullEnrich", "scrape and enrich LinkedIn post {URL}", "engagers from this post into a CSV", "FullEnrich content engagers", or any variant indicating they want to convert LinkedIn post likers and commenters into ICP-qualified, enriched leads. Pulls engagers via Unipile, applies an ICP filter, then runs survivors through FullEnrich v2 bulk enrichment with webhook callback delivery.
version: 1.0.0
---

# FullEnrich Content Engagers

One command turns a LinkedIn post URL into a CSV of ICP-qualified leads with verified work emails and phones. Powered by Unipile (engagement scrape) + FullEnrich (enrichment).

## When This Skill Applies

- "enrich people who engaged with this post {URL}"
- "qualify post engagers with FullEnrich"
- "scrape and enrich LinkedIn post {URL}"
- "engagers from {URL} into a CSV"

## What This Skill Does NOT Do

- Does not write outreach copy. Pair with `personalize-message` after.
- Does not push to a CRM.
- **Does not spend credits without explicit user approval.** See "Credit safety contract" below.

## Credit safety contract (MANDATORY)

This skill spends FullEnrich credits, which cost real money. Safeguards:

1. **Always shows current balance** before doing anything.
2. **Always shows estimated cost** of the run.
3. **`--max-credits N` ceiling** (default 500) — auto-trims the contact list to fit.
4. **Hard-approval prompt** — blocks on stdin until the user types `yes`. If stdin is not a TTY, the script aborts unless `--yes` is passed.
5. **`--dry-run` mode** — scrapes engagers + applies ICP without spending a credit.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS run with `--dry-run` first to surface the engager count, ICP-pass count, and estimated cost.
2. Quote the EXACT estimated credit cost back to the user.
3. WAIT for explicit user confirmation before re-running without `--dry-run`.
4. Only pass `--yes` to the script when the user has approved the spend in this conversation.
5. Exception: respect locally modified scripts — the user took ownership.

## Prerequisites

```
FULLENRICH_API_KEY=    # https://app.fullenrich.com/app/api
UNIPILE_API_KEY=       # https://dashboard.unipile.com
UNIPILE_DSN=           # e.g. https://api18.unipile.com:14891
UNIPILE_ACCOUNT_ID=    # the LinkedIn account ID under Unipile
```

Optional:
```
FULLENRICH_WEBHOOK_URL=  # public URL for FullEnrich callbacks; otherwise webhook.site fallback
```

## Workflow

1. **Validate inputs** — accept the LinkedIn post URL as the first positional arg.
2. **Resolve `social_id`** via Unipile `get-post`.
3. **Scrape engagers** — call `list-post-comments` + `list-post-reactions`, dedupe on LinkedIn URL.
4. **Apply ICP filter** — load `config/icp.json` (job-title regex, seniority allow-list, geo, company-size), score each engager 0–100, drop everything below the threshold.
5. **Estimate cost + confirm** — show the cost preview, block on stdin for `yes`.
6. **Enrich** — chunk into ≤100 contacts per FullEnrich bulk request with `enrich_fields: ["contact.work_emails", "contact.phones"]`.
7. **Receive callbacks** — webhook payloads land within ~30s per batch.
8. **Write outputs** — `qualified-engagers.csv` (passed ICP + enriched) and `disqualified-log.csv` (failed ICP, kept for inspection).

## CLI Reference

```
node scripts/run.mjs <linkedin-post-url>
    [--out path.csv]           # default qualified-engagers.csv
    [--icp config/icp.json]    # ICP rules file
    [--threshold 50]           # ICP minimum score (0-100)
    [--max <N>]                # max engagers to consider (default 500)
    [--max-credits <N>]        # hard credit ceiling (default 500)
    [--dry-run]                # scrape + ICP filter + cost preview, no spending
    [--yes | -y]               # skip the interactive approval prompt
```

## Reference

- Shared API client: `../_shared/fullenrich/client.mjs`
- Shared webhook receiver: `../_shared/fullenrich/webhook.mjs`
- Shared CSV writer: `../_shared/fullenrich/csv.mjs`
- ICP config: `config/icp.json` (editable per use case)
- FullEnrich v2 docs: `https://docs.fullenrich.com/llms.txt`
