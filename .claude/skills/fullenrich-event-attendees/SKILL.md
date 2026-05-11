---
name: fullenrich-event-attendees
description: Use when the user says "enrich this LinkedIn event", "enrich attendees of this event", "enrich this attendees CSV", "scrape and enrich LinkedIn event {URL}", "FullEnrich event attendees", or any variant indicating they want to turn LinkedIn event attendees into an SDR-ready CSV with verified emails and mobile phones. Two input modes: (a) bring-your-own attendees CSV (PhantomBuster, Evaboot, Sales Navigator, manual paste), or (b) run a user-configured Apify actor against a LinkedIn event URL. Both converge on FullEnrich v2 bulk enrichment with webhook callback delivery.
version: 2.0.0
---

# FullEnrich Event Attendees

Turn a list of LinkedIn event attendees into an SDR-ready CSV with verified work emails and mobile phones, using the FullEnrich 20-vendor waterfall.

## When This Skill Applies

- "enrich attendees of this event {URL}"
- "enrich this attendees CSV"
- "scrape and enrich LinkedIn event {URL}"
- "FullEnrich event attendees"

## Two input modes

The skill does NOT bundle a LinkedIn event scraper. LinkedIn doesn't expose event attendees through any clean public API and Unipile's surface area doesn't cover events either. So the skill ships with two input paths and the user picks:

**Mode A — CSV file (recommended).** Bring an attendees CSV from any source:
- Manual copy-paste from the LinkedIn event page
- [PhantomBuster](https://phantombuster.com/) "LinkedIn Event Attendees Export" automation
- [Evaboot](https://evaboot.com/) Sales Navigator export filtered to event registrants
- Any other tool

**Mode B — Apify actor (BYO).** The user configures an Apify actor (e.g. `giovannibiancia/linkedin-events-partecipants-scraper`) under their own Apify account, supplies their LinkedIn cookies via env vars, and the skill runs it. The skill does not pin a specific actor — the user picks one and provides the actor input shape via `--actor-input` if its keys differ from the defaults.

## What This Skill Does NOT Do

- Does not include a built-in LinkedIn event scraper. Pick mode A or B above.
- Does not write outreach copy. Pair with `personalize-message` after.
- Does not push to a CRM.
- **Does not spend FullEnrich credits without explicit user approval.** See "Credit safety contract" below.

## Credit safety contract (MANDATORY)

This skill spends FullEnrich credits, which cost real money. Safeguards:

1. **Always shows current balance** before doing anything.
2. **Always shows estimated cost** of the run.
3. **`--max-credits N` ceiling** (default 500) — auto-trims the contact list to fit.
4. **Hard-approval prompt** — blocks on stdin until the user types `yes`. Non-TTY without `--yes` aborts.
5. **`--dry-run` mode** — parses input + computes cost preview without spending a credit.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS run with `--dry-run` first to surface the attendee count and estimated cost.
2. Quote the EXACT estimated credit cost back to the user.
3. WAIT for explicit user confirmation before re-running without `--dry-run`.
4. Only pass `--yes` after the user has approved the spend in this conversation.
5. Exception: respect locally modified scripts.

## Prerequisites

```
FULLENRICH_API_KEY=    # https://app.fullenrich.com/app/api
```

For Apify mode (Mode B) only:
```
APIFY_TOKEN=               # https://console.apify.com/account/integrations
LINKEDIN_LI_AT=            # browser cookie 'li_at' from a logged-in LinkedIn session
LINKEDIN_JSESSIONID=       # browser cookie 'JSESSIONID'
LINKEDIN_USER_AGENT=       # full UA string from the same browser
```

Optional:
```
FULLENRICH_WEBHOOK_URL=    # public URL for callbacks; otherwise a webhook.site URL is provisioned
```

## CLI Reference

**Mode A — CSV file:**
```
node scripts/run.mjs --input attendees.csv
    [--out path.csv]            # default attendees.csv (overwrite-safe via different name)
    [--max <N>]                 # max attendees to consider (default 250)
    [--max-credits <N>]         # hard credit ceiling (default 500)
    [--dry-run]                 # no spending
    [--yes | -y]                # skip the interactive approval prompt
```

**Mode B — Apify actor:**
```
node scripts/run.mjs --event-url https://www.linkedin.com/events/<id>/
                     --actor <user>/<actor-slug>
    [--actor-input '{"event_urls":["..."],"cookies":[...]}']  # override input shape per actor
    [--out path.csv] [--max N] [--max-credits N] [--dry-run] [--yes]
```

## Workflow

1. Validate inputs and load contacts (Mode A: parse CSV; Mode B: run Apify actor with humanlike polling).
2. Map every row to FullEnrich-ready contact fields (`first_name`, `last_name`, `linkedin_url`, `company_name`, `domain`, `title`).
3. Estimate FullEnrich credit cost from the contact list.
4. Show cost preview, block on stdin for `yes`.
5. Chunk into ≤100 contacts per FullEnrich bulk request, request `contact.work_emails` + `contact.phones`.
6. Receive webhook callbacks (~30s per batch).
7. Write enriched CSV with `first_name, last_name, linkedin_url, email, email_status, phone, company_domain`.

## Reference

- Shared API client: `../_shared/fullenrich/client.mjs`
- Shared webhook receiver: `../_shared/fullenrich/webhook.mjs`
- Shared CSV reader/writer: `../_shared/fullenrich/csv.mjs`
- FullEnrich v2 docs: `https://docs.fullenrich.com/llms.txt`
- Webhook payload shape (verified live):
  ```
  { id, name, status: "FINISHED", cost: { credits },
    data: [{ input, custom, contact_info: {
      most_probable_work_email: { email, status },
      work_emails, personal_emails, phones } }] }
  ```
