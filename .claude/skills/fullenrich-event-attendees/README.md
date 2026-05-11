# fullenrich-event-attendees

Turn LinkedIn event attendees into an SDR-ready CSV with verified work emails and mobile phones. Powered by [FullEnrich](https://fullenrich.com) v2.

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-event-attendees
cp .env.example .env
# Fill FULLENRICH_API_KEY (always required)
```

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

**Where to get the CSV:**

| Source | How |
|--------|-----|
| Manual | Open the LinkedIn event page, copy the attendee list, paste into a spreadsheet, export CSV |
| [PhantomBuster](https://phantombuster.com/) | "LinkedIn Event Attendees Export" Phantom, ~$0.005 per attendee |
| [Evaboot](https://evaboot.com/) | Sales Navigator → filter by event registrants → export |
| Anything else | Apify, custom scraper, friend with a Sales Navigator subscription |

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

Most actors require LinkedIn session cookies. To extract them:

1. Log into LinkedIn in Chrome
2. DevTools → Application → Cookies → `linkedin.com`
3. Copy the values of `li_at` and `JSESSIONID`
4. Get your User-Agent from `chrome://version`
5. Paste all three into `.env` (LINKEDIN_LI_AT, LINKEDIN_JSESSIONID, LINKEDIN_USER_AGENT)
6. Add your `APIFY_TOKEN`

Then:

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

- **CSV mode:** zero scrape cost (you bring the file)
- **Apify mode:** depends on the actor (usually $0.30–$1 per event)
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
