# fullenrich-plg-reverse-lookup

Turn a free-trial signup email into an identified person + LinkedIn profile + company, in real time. Powered by [FullEnrich](https://fullenrich.com) reverse email lookup (v2).

Two install paths in one repo: a CLI batch processor (cron-friendly) and a hosted Vercel webhook (signup events live).

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## Path A — CLI batch

Process a CSV or JSON of recent signups in one shot.

### Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-plg-reverse-lookup
cp .env.example .env
# Fill FULLENRICH_API_KEY
```

### Run

```bash
# Default: dedupe + ask before spending
node scripts/batch.mjs --input signups.csv --out enriched.json

# Preview without spending
node scripts/batch.mjs --input signups.csv --dry-run

# Hard ceiling at 50 credits, skip prompt for cron
node scripts/batch.mjs --input signups.csv --out enriched.json --max-credits 50 --yes
```

The input file can be a CSV with an `email` column or a JSON array of `{email, custom?}` objects.

### Output

JSON array of FullEnrich reverse-lookup results, one per email — identified contact info plus the original `custom` payload echoed back so you can correlate.

## Path B — Hosted webhook (real-time)

Deploy a hosted endpoint that identifies signup emails in ~30 seconds. Pure FullEnrich output: a structured JSONL log plus an optional generic forward webhook. Pipe wherever you want.

### Deploy

```bash
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-plg-reverse-lookup
vercel deploy
# Set env vars on your host:
#   FULLENRICH_API_KEY=<your key>
#   WEBHOOK_DRY_RUN=1            <-- IMPORTANT for the first 24h
#   MAX_CREDITS_PER_DAY=200
#   PLG_LOG_PATH=<optional, default /tmp/plg-enriched.jsonl>
#   FORWARD_WEBHOOK_URL=<optional, any URL the enriched record gets POSTed to>
```

### Wire your product

POST signup events to your deploy URL right after a user signs up:

```
POST https://<your-deploy>.vercel.app/api/webhook
Content-Type: application/json

{ "email": "user@example.com", "custom": { "plan": "free-trial" } }
```

### Flow

```
Your product ──POST email──▶ /api/webhook
                                  │
                                  ▼
                        FullEnrich reverse lookup (async)
                                  │
                                  ▼
                       /api/fullenrich-callback (~30s later)
                                  │
                                  ├──▶ Appended to JSONL log (PLG_LOG_PATH)
                                  └──▶ Optional POST to FORWARD_WEBHOOK_URL
```

You wire the log or the forward URL to whatever downstream stack you run.

## Credit safety

CLI mode (Path A):
- **Cost preview** before any API call
- **Hard approval** — type `yes` (or pass `--yes`)
- **`--max-credits` ceiling** auto-trims the email list

Webhook mode (Path B):
- **`MAX_CREDITS_PER_DAY` ceiling** — webhook returns HTTP 429 once exceeded. Counter persists in `/tmp/lookup-counter.json` for cold-start safety.
- **`WEBHOOK_DRY_RUN=1`** — endpoint validates payload and logs intent but does NOT call FullEnrich. Use this for the first 24 hours after deploy, then remove the flag to go live.

## Companion skills

- **[fullenrich-event-attendees](../fullenrich-event-attendees/)** — LinkedIn event URL
- **[fullenrich-content-engagers](../fullenrich-content-engagers/)** — LinkedIn post URL
- **[fullenrich-network-activation](../fullenrich-network-activation/)** — co-founder Connections.csv

## License

MIT.
