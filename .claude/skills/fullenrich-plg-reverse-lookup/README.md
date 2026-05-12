# fullenrich-plg-reverse-lookup

Turn a free-trial signup email into an identified person + LinkedIn profile + company, in real time. Powered by [FullEnrich](https://fullenrich.com) reverse email lookup (v2).

Two install paths in one repo: a CLI batch processor (cron-friendly) and a hosted webhook (signup events live).

Part of the [Yalc x FullEnrich](https://yalc.ai/skills/fullenrich/) skill family.

## What you need

| Provider | When | Cost | Where to get it |
|----------|------|------|-----------------|
| FullEnrich API key | Always | ~1 credit per email reverse-lookup | https://app.fullenrich.com/app/api |
| A Vercel-compatible host | Path B (real-time webhook) only | Free tier covers thousands of signups/mo | https://vercel.com/signup |

This skill is fully self-contained. Everything it needs lives in this folder. Zero npm dependencies.

## Install

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-plg-reverse-lookup
cp .env.example .env
# Fill FULLENRICH_API_KEY
```

## Set up FullEnrich

1. Sign up at https://fullenrich.com.
2. Open https://app.fullenrich.com/app/api and copy the API key.
3. Paste into `.env` as `FULLENRICH_API_KEY=...`.

## Path A — CLI batch

Process a CSV or JSON of recent signups in one shot. Good for nightly cron jobs that backfill yesterday's signups.

### Run

```bash
# Default: dedupe + ask before spending
node scripts/batch.mjs --input signups.csv --out enriched.json

# Preview without spending
node scripts/batch.mjs --input signups.csv --dry-run

# Hard ceiling at 50 credits, skip prompt for cron
node scripts/batch.mjs --input signups.csv --out enriched.json --max-credits 50 --yes
```

The input file can be a CSV with an `email` column or a JSON array of `{ email, custom? }` objects.

### Output

JSON array of FullEnrich reverse-lookup results, one per email — identified contact info (name, title, company, LinkedIn URL, location) plus the original `custom` payload echoed back so you can correlate.

## Path B — Hosted webhook (real-time)

Deploy a hosted endpoint that identifies signup emails in ~30 seconds. Pure FullEnrich output: a structured JSONL log plus an optional generic forward webhook. Pipe wherever you want.

### One-time Vercel setup

If you don't already have Vercel:

1. **Sign up at https://vercel.com/signup** (free).
2. **Install the CLI:** `npm i -g vercel`
3. **Log in once:** `vercel login` and follow the email confirmation.

### Deploy this skill

```bash
cd YALC-the-GTM-operating-system/.claude/skills/fullenrich-plg-reverse-lookup
vercel deploy
# Confirm the project name (e.g. "plg-reverse-lookup") and the production deploy.
```

After deploy, set env vars on your Vercel project:

```
Project → Settings → Environment Variables → Add for "Production":

  FULLENRICH_API_KEY=<your key>
  WEBHOOK_DRY_RUN=1            ← IMPORTANT for the first 24h
  MAX_CREDITS_PER_DAY=200
  PLG_LOG_PATH=<optional, default /tmp/plg-enriched.jsonl>
  FORWARD_WEBHOOK_URL=<optional, any URL the enriched record gets POSTed to>
```

Redeploy after adding env vars (`vercel deploy` again) so they pick up.

### Wire your product

POST signup events to your deploy URL right after a user signs up:

```
POST https://<your-deploy>.vercel.app/api/webhook
Content-Type: application/json

{ "email": "user@example.com", "custom": { "plan": "free-trial" } }
```

Any backend, auth provider, or payment processor that supports outbound webhooks on user-creation can fire this. Many platforms let you configure a webhook URL directly. Otherwise add a 3-line fetch call to your signup handler.

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

### Going live

The `WEBHOOK_DRY_RUN=1` flag means the endpoint validates payloads and logs intent but does NOT call FullEnrich — zero credits spent. Use it for the first 24 hours after deploy to verify your product's signup wiring is sending you the right payloads. When you're ready:

1. Vercel dashboard → Settings → Environment Variables → set `WEBHOOK_DRY_RUN=0`
2. Redeploy

Each signup will now consume 1 FullEnrich credit and produce one enriched record in your log + forward webhook.

## Credit safety

CLI mode (Path A):
- **Cost preview** before any API call
- **Hard approval** — type `yes` (or pass `--yes`)
- **`--max-credits` ceiling** auto-trims the email list

Webhook mode (Path B):
- **`MAX_CREDITS_PER_DAY` ceiling** — webhook returns HTTP 429 once exceeded. Counter persists in `/tmp/lookup-counter.json` for cold-start safety.
- **`WEBHOOK_DRY_RUN=1`** — endpoint validates payload and logs intent but does NOT call FullEnrich.

## Companion skills

- **[fullenrich-event-attendees](../fullenrich-event-attendees/)** — LinkedIn event URL
- **[fullenrich-content-engagers](../fullenrich-content-engagers/)** — LinkedIn post URL
- **[fullenrich-network-activation](../fullenrich-network-activation/)** — co-founder Connections.csv

## License

MIT.
