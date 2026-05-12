# fullenrich-network-activation

Turn a LinkedIn `Connections.csv` export (yours, your co-founder's, your team's) into a ranked, ICP-qualified, FullEnrich-verified lead list. Built for new GTM operators in week one.

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## What you need

| Provider | Why | Cost | Where to get it |
|----------|-----|------|-----------------|
| FullEnrich API key | Enrich connections that don't have an email in their LinkedIn export | ~1 credit per work email, 2 per phone | https://app.fullenrich.com/app/api |
| `Connections.csv` from LinkedIn | The raw network list (yours + each team member's) | Free | See "Get the LinkedIn Connections export" below |

This skill is fully self-contained. Everything it needs lives in this folder. Zero npm dependencies.

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-network-activation
cp .env.example .env
# Fill FULLENRICH_API_KEY
```

## Set up FullEnrich

1. Sign up at https://fullenrich.com.
2. Open https://app.fullenrich.com/app/api and copy the API key.
3. Paste into `.env` as `FULLENRICH_API_KEY=...`.

## Get the LinkedIn Connections export

Each team member runs this flow once:

1. Open LinkedIn → click your photo → **Settings & Privacy**
2. **Data privacy** → **Get a copy of your data**
3. Tick **Connections only** (the smaller, faster export), then **Request archive**
4. Wait for the email LinkedIn sends — usually 10 to 20 minutes
5. Download the zip, extract `Connections.csv`
6. Drop it in a shared folder, or rename it `Connections-<name>.csv` so multiple exports don't clash

The CSV has a "Notes:" preamble at the top before the actual header row — the skill handles that automatically.

## Run

```bash
# Default: parse + ICP filter + ask before spending
node scripts/run.mjs ~/Downloads/Connections.csv

# Preview the qualified list and estimated credit cost without spending
node scripts/run.mjs ~/Downloads/Connections.csv --dry-run

# Custom ICP, threshold 70, hard ceiling at 200 credits
node scripts/run.mjs ~/Downloads/Connections.csv --icp my-icp.json --threshold 70 --max-credits 200

# Skip the prompt (CI / scripted)
node scripts/run.mjs ~/Downloads/Connections.csv --yes
```

## Pool multiple exports (the team move)

If you have several team members' Connections.csv files, dedupe + score them all at once:

```bash
# Merge first (the skill dedupes by LinkedIn URL automatically)
cat ~/Downloads/Connections-othmane.csv ~/Downloads/Connections-alice.csv > /tmp/merged.csv
node scripts/run.mjs /tmp/merged.csv --dry-run
```

The skill auto-skips connections that already have an `Email Address` in the LinkedIn export, so you only spend credits on contacts that need enrichment.

## Output

| File | Contents |
|------|----------|
| `priority-network.csv` | Passed ICP + enriched, ranked by ICP score |
| `priority-network-disqualified.csv` | Failed ICP, with score + reasons |

## ICP rules

Edit `config/icp.json`. Same format as `fullenrich-content-engagers`:

```json
{
  "threshold": 50,
  "rules": [{ "field": "title", "kind": "regex", "pattern": "(?i)\\b(ceo|cmo|cro)\\b", "score": 40, "reason": "C-level" }],
  "exclusions": [{ "field": "title", "kind": "regex", "pattern": "(?i)\\b(student|intern)\\b", "reason": "Out of ICP" }]
}
```

Supported `kind`: `regex`, `contains_any`, `equals`. Regex patterns can start with `(?i)` for case-insensitive matching.

## Credit safety

Three layers of protection:
1. **Cost preview** before any API call
2. **Hard approval** — script blocks until you type `yes` (or pass `--yes`)
3. **`--max-credits` ceiling** auto-trims the qualified list

## Companion skills

- **[fullenrich-event-attendees](../fullenrich-event-attendees/)** — LinkedIn event URL
- **[fullenrich-content-engagers](../fullenrich-content-engagers/)** — LinkedIn post URL
- **[fullenrich-plg-reverse-lookup](../fullenrich-plg-reverse-lookup/)** — PLG signup events

## License

MIT.
