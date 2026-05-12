# fullenrich-event-attendees

Turn LinkedIn event attendees into an SDR-ready CSV with verified work emails and mobile phones. Powered by [FullEnrich](https://fullenrich.com) v2.

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## What you need

| Provider | When | Cost | Where to get it |
|----------|------|------|-----------------|
| FullEnrich API key | Always | ~1 credit per work email, 2 per phone | https://app.fullenrich.com/app/api |
| Attendees CSV | Mode A (recommended) | Free (manual) or ~$0.005/attendee (PhantomBuster / Evaboot) | See "Get an attendees CSV" below |
| Apify account + LinkedIn cookies | Mode B (URL → CSV) | $5–$49/mo Apify plan, ~$0.30–$1 per event run | See "Mode B — Apify setup" below |

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-event-attendees
cp .env.example .env
# Fill FULLENRICH_API_KEY (always required)
```

This skill is self-contained. Everything it needs lives in this folder. Zero npm dependencies.

## Set up FullEnrich

1. Sign up at https://fullenrich.com and pick a plan (or start the free trial).
2. Open https://app.fullenrich.com/app/api and copy the API key.
3. Paste into `.env` as `FULLENRICH_API_KEY=...`.

## Two ways to run it

LinkedIn does not expose event attendees through any clean API, and Unipile doesn't cover events either. So the skill keeps it simple: bring your own attendee list, two paths.

### Mode A — CSV file (recommended)

Get an attendees CSV any way you like, then run:

```bash
# Always preview first
node scripts/run.mjs --input attendees.csv --dry-run

# Then enrich
node scripts/run.mjs --input attendees.csv --out enriched.csv
```

#### Get an attendees CSV

**Option 1 — Manual paste (free, 5 min).**
1. Open the LinkedIn event page in a browser.
2. Click the "Attendees" tab or the event-attendee count link.
3. Scroll until everyone has loaded.
4. Use a browser extension like [Data Miner](https://data-miner.io/) or [Instant Data Scraper](https://www.webrobots.io/) to grab the visible names + profile URLs into a spreadsheet.
5. Save as CSV with at minimum the columns `First Name`, `Last Name`, `Profile URL`.

**Option 2 — PhantomBuster (paid, ~$0.005/attendee).**
1. Sign up at https://phantombuster.com.
2. Find the "LinkedIn Event Attendees Export" Phantom in the store.
3. Click "Use this Phantom" → paste your LinkedIn event URL → connect your LinkedIn session (PhantomBuster has a Chrome extension for this).
4. Launch the Phantom. Download the result CSV when it completes.

**Option 3 — Evaboot (paid, Sales Navigator required).**
1. Open https://evaboot.com and connect Sales Navigator.
2. Use a Sales Navigator search filtered to "Attended event: <event name>" (a LinkedIn Sales Nav feature).
3. Export the filtered list via Evaboot.

**Option 4 — Any other source.** Manual research, a colleague's export, a custom scraper. The skill accepts any CSV with one of the common header variants below.

**Accepted CSV column headers** (case-insensitive, the script tries common variants):

| FullEnrich field | Acceptable headers |
|------------------|--------------------|
| first_name | `First Name`, `firstName`, `first_name` (or fallback: split `Full Name` / `Name`) |
| last_name | `Last Name`, `lastName`, `last_name` |
| linkedin_url | `Profile URL`, `LinkedIn URL`, `profileUrl`, `linkedinProfileUrl`, `url` |
| company_name | `Company`, `companyName`, `currentCompany` |
| domain | `Company Domain`, `companyDomain`, `Website` |
| title | `Title`, `Position`, `currentJobTitle`, `jobTitle`, `headline` |

Missing columns are tolerated; FullEnrich works best with at least name + LinkedIn URL or name + company.

### Mode B — Apify actor (BYO)

If you want a one-shot URL → CSV pipeline, set up an Apify account, pick an actor that scrapes LinkedIn event attendees, and pass it to the skill. The skill does NOT bundle a specific actor — pick one in the [Apify Store](https://apify.com/store?search=linkedin+event+attendees).

#### Mode B — Apify setup

1. **Sign up at https://apify.com.** Free tier is fine for testing.
2. **Get your API token.** Account → Settings → Integrations → API token. Paste into `.env` as `APIFY_TOKEN=...`.
3. **Pick an actor.** Search the Apify Store for "linkedin event attendees". Reliable choices we've tested: `giovannibiancia/linkedin-events-partecipants-scraper`. Each actor has its own pricing (usually $5–$49/mo platform + per-run cost).
4. **Extract LinkedIn cookies.** Most actors need an authenticated LinkedIn session via your `li_at` and `JSESSIONID` cookies:
   1. Log into LinkedIn in Chrome.
   2. Open DevTools (⌘⌥I / Ctrl+Shift+I) → Application → Cookies → `linkedin.com`.
   3. Copy the **value** of the cookies named `li_at` and `JSESSIONID`.
   4. Get your User-Agent from `chrome://version` (the line labeled "User Agent").
5. **Paste all four into `.env`:**
   ```
   APIFY_TOKEN=apify_api_xxxxxxxxxx
   LINKEDIN_LI_AT=AQEDAR...
   LINKEDIN_JSESSIONID=ajax:1234567890
   LINKEDIN_USER_AGENT=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...
   ```

Cookies rotate every few weeks; re-extract when the actor starts returning 0 results.

#### Run with Apify

```bash
# Always preview first
node scripts/run.mjs \
    --event-url https://www.linkedin.com/events/7445288180402278400/ \
    --actor giovannibiancia/linkedin-events-partecipants-scraper \
    --dry-run

# Then enrich
node scripts/run.mjs \
    --event-url https://www.linkedin.com/events/7445288180402278400/ \
    --actor giovannibiancia/linkedin-events-partecipants-scraper \
    --out enriched.csv
```

If the actor's input keys don't match the defaults (`event_urls`, `cookies`, `userAgent`), pass the exact shape:

```bash
node scripts/run.mjs --event-url https://... --actor <user/slug> \
    --actor-input '{"eventUrl":"...","sessionCookie":"..."}'
```

## Output

A CSV with columns:

| first_name | last_name | linkedin_url | email | email_status | phone | company_domain |
|------------|-----------|--------------|-------|--------------|-------|----------------|

`email_status` is one of `DELIVERABLE`, `RISKY`, `INVALID`, `UNKNOWN` — the result of FullEnrich's triple verification waterfall.

## Cost

- **CSV mode:** zero scrape cost (you bring the file), or ~$0.005 per attendee if you use PhantomBuster.
- **Apify mode:** depends on the actor (usually $0.30–$1 per event).
- **FullEnrich:** 1 credit per `contact.work_emails` + 2 per `contact.phones`. A 200-attendee event ≈ 600 credits.

Check balance before running:
```bash
node -e "import('./scripts/lib/fullenrich-client.mjs').then(m=>m.getCredits().then(console.log))"
```

## Credit safety

Three layers of protection:

1. **Cost preview** — every run prints estimated credits, current balance, and remaining balance before any API call.
2. **Hard approval** — the script blocks on stdin and requires you to type `yes`. No silent enrichment.
3. **`--max-credits` ceiling** — default 500. Auto-trims the contact list to fit. Override per-run.

```
  ┌─ FullEnrich spend preview ────────────────────
  │  Action:           Enrich 187 attendees from CSV file attendees.csv
  │  Estimated cost:   ~561 credits
  │  Current balance:  1006 credits
  │  After this run:   ~445 credits
  └────────────────────────────────────────────────

  Proceed? Type "yes" to continue, anything else to abort:
```

## Companion skills

- **[fullenrich-content-engagers](../fullenrich-content-engagers/)** — same pipeline starting from a LinkedIn post URL, with ICP qualification gates
- **[fullenrich-network-activation](../fullenrich-network-activation/)** — enrich a co-founder's LinkedIn `Connections.csv` export
- **[fullenrich-plg-reverse-lookup](../fullenrich-plg-reverse-lookup/)** — reverse email lookup for PLG signup events

## License

MIT. Use at your own risk; LinkedIn ToS applies to any scrape step you operate.
