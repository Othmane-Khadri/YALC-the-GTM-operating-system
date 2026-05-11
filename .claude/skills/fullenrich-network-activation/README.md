# fullenrich-network-activation

Turn a LinkedIn `Connections.csv` export (yours, your co-founder's, your team's) into a ranked, ICP-qualified, FullEnrich-verified lead list. Built for new GTM operators in week one.

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## Sourcing the export

1. LinkedIn → Settings & Privacy → Data privacy → **Get a copy of your data**
2. Tick **Connections** only
3. Wait for the email (10–20 minutes), download the zip, extract `Connections.csv`

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-network-activation
cp .env.example .env
# Fill FULLENRICH_API_KEY
```

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

## Output

| File | Contents |
|------|----------|
| `priority-network.csv` | Passed ICP + enriched, ranked by ICP score |
| `priority-network-disqualified.csv` | Failed ICP, with score + reasons |

The script auto-skips connections that already have an `Email Address` in the LinkedIn export, so you only spend credits on contacts that need enrichment.

## ICP rules

Edit `config/icp.json`. Same format as `fullenrich-content-engagers`:

```json
{
  "threshold": 50,
  "rules": [{ "field": "title", "kind": "regex", "pattern": "...", "score": 40, "reason": "..." }],
  "exclusions": [{ "field": "title", "kind": "regex", "pattern": "...", "reason": "..." }]
}
```

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
