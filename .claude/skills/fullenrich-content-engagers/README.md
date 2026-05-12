# fullenrich-content-engagers

Turn a LinkedIn post URL into a CSV of ICP-qualified leads with verified work emails and phones. Powered by [Unipile](https://unipile.com) (engagement scrape) + [FullEnrich](https://fullenrich.com) (waterfall enrichment).

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## What you need

| Provider | Why | Cost | Where to get it |
|----------|-----|------|-----------------|
| FullEnrich API key | Enrich qualified engagers with verified emails and phones | ~1 credit per work email, 2 per phone | https://app.fullenrich.com/app/api |
| Unipile account + LinkedIn connection | Scrape reactions and comments from a LinkedIn post URL | ~$50/mo for the starter plan; one LinkedIn account included | https://www.unipile.com/pricing/ |

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-content-engagers
npm install
cp .env.example .env
# Fill the four required keys (see "Set up the providers" below)
```

This skill is self-contained. Everything it needs lives in this folder. You can copy this folder anywhere outside the repo and it still works as long as `npm install` runs there.

## Set up the providers

### 1. FullEnrich

1. Sign up at https://fullenrich.com and choose a plan (or start the free trial).
2. Open https://app.fullenrich.com/app/api and copy the API key.
3. Paste it into `.env` as `FULLENRICH_API_KEY=...`.

### 2. Unipile

Unipile is the messaging-and-social API that lets us pull engagers on LinkedIn posts from the official surface (no scraping, no cookies). Setup takes ~5 minutes.

1. **Sign up:** https://dashboard.unipile.com/
2. **Find your DSN.** In the dashboard, the DSN is the base URL of your Unipile account, usually something like `https://api18.unipile.com:14891`. Paste it into `.env` as `UNIPILE_DSN=...`.
3. **Create an API access token.** Dashboard → Settings → API Access → New Access Token. Paste into `.env` as `UNIPILE_API_KEY=...`.
4. **Connect your LinkedIn account.** Dashboard → Accounts → Add Account → LinkedIn → follow the hosted auth flow. This logs in once and Unipile stores the session.
5. **Find the account ID.** Dashboard → Accounts → click on your LinkedIn account. The 22-character ID at the top is `UNIPILE_ACCOUNT_ID`. Paste into `.env`.

The skill only uses Unipile's read endpoints (`getPost`, `getAllPostComments`, list reactions). It does not send messages, does not save anything to your inbox.

If Unipile is not an option for you, this skill will not work as-is. Pick a different LinkedIn engagement scraper (PhantomBuster, Apify) and adapt `scripts/run.mjs` to call your scraper instead of `u.client.users.getPost`.

## Run

```bash
# Default: scrape + ICP filter + ask before spending
node scripts/run.mjs https://www.linkedin.com/posts/...

# Preview pipeline output and estimated cost without spending anything
node scripts/run.mjs https://www.linkedin.com/posts/... --dry-run

# Use a custom ICP rules file with a 70/100 minimum score
node scripts/run.mjs https://www.linkedin.com/posts/... --icp my-icp.json --threshold 70

# Hard credit ceiling at 100, skip the prompt for CI
node scripts/run.mjs https://www.linkedin.com/posts/... --max-credits 100 --yes
```

The script handles every common LinkedIn post URL shape and the `urn:li:share:` / `urn:li:activity:` URN formats automatically.

## Output

Two CSVs side by side:

| File | Contents |
|------|----------|
| `qualified-engagers.csv` | Passed ICP, enriched: first/last/linkedin/email/email_status/phone/company_domain |
| `qualified-engagers-disqualified.csv` | Failed ICP, kept for inspection: first/last/linkedin/title/score/reasons |

## ICP rules

Edit `config/icp.json` to match your buyer. The default rules score for senior GTM/marketing/sales/RevOps roles. Format:

```json
{
  "threshold": 50,
  "rules": [
    { "field": "title", "kind": "regex", "pattern": "(?i)\\b(founder|ceo|cmo)\\b", "score": 40, "reason": "C-level" }
  ],
  "exclusions": [
    { "field": "title", "kind": "regex", "pattern": "(?i)\\b(student|intern|recruiter)\\b", "reason": "Out of ICP" }
  ]
}
```

Supported `kind`: `regex`, `contains_any`, `equals`. Regex patterns can start with `(?i)` for case-insensitive matching (the script parses Perl-style inline flags and converts them to the JavaScript RegExp flag).

## Credit safety

Same three-layer protection as the rest of the FullEnrich skills:

1. **Cost preview** before any API call.
2. **Hard approval** — script blocks until you type `yes` (or pass `--yes`).
3. **`--max-credits` ceiling** auto-trims the qualified list to fit.

## Companion skills

- **[fullenrich-event-attendees](../fullenrich-event-attendees/)** — same pipeline starting from a LinkedIn event URL
- **[fullenrich-network-activation](../fullenrich-network-activation/)** — enrich a co-founder's `Connections.csv`
- **[fullenrich-plg-reverse-lookup](../fullenrich-plg-reverse-lookup/)** — reverse email lookup for PLG signups

## License

MIT.
