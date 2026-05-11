# fullenrich-content-engagers

Turn a LinkedIn post URL into a CSV of ICP-qualified leads with verified work emails and phones. Powered by [Unipile](https://unipile.com) (engagement scrape) + [FullEnrich](https://fullenrich.com) (waterfall enrichment).

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-content-engagers
cp .env.example .env
# Fill FULLENRICH_API_KEY, UNIPILE_API_KEY, UNIPILE_DSN, UNIPILE_ACCOUNT_ID
```

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
    { "field": "title", "kind": "regex", "pattern": "...", "score": 40, "reason": "..." }
  ],
  "exclusions": [
    { "field": "title", "kind": "regex", "pattern": "(?i)\\b(student|intern|recruiter)\\b", "reason": "..." }
  ]
}
```

Supported `kind`: `regex`, `contains_any`, `equals`.

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
