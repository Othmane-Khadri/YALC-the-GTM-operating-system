---
name: launch-linkedin-campaign
description: "Set up a LinkedIn outreach campaign on a list of leads (connect → DM1 → DM2 sequence) by chaining `campaign:create` and `campaign:create-sequence`. Enforces the outbound hypothesis gate (refuses to launch without a hypothesis recorded for outreach-campaign-builder). Use when the user says 'launch a LinkedIn campaign for these leads', 'send a LinkedIn outreach to this list', 'start the outbound to the qualified leads', 'run the LinkedIn sequence on this result set', or 'fire the connect-then-DM flow'. Side-effecting — writes to SQLite and stages the sequence on Unipile."
version: 1.0.0
---

# Launch LinkedIn Campaign

I'll wrap two CLI commands — `campaign:create` (creates the campaign + pulls qualified leads from the holding pool) and `campaign:create-sequence` (drafts the connect→DM1→DM2 sequence). Both side-effecting → both shell-out per the 0.13.0 architecture.

## When This Skill Applies

Use this skill when the user says:

- "launch a LinkedIn campaign for these leads"
- "send a LinkedIn outreach to this list"
- "start the outbound to the qualified leads"
- "run the LinkedIn sequence on this result set"
- "fire the connect-then-DM flow"

**NOT this skill** (use `qualify-leads` instead):
- "score these leads first" / "qualify the engagers" — qualification runs the 7-gate pipeline. Run that BEFORE this skill.

**NOT this skill** (use `personalize-message` instead):
- "personalize a single DM" — that's per-lead copy. This skill handles bulk sequence generation.

**NOT this skill** (use `scrape-post-engagers` instead):
- "pull who liked this post" — that produces a result set. This skill consumes a holding pool of qualified leads.

## What This Skill Does

1. **Hypothesis gate.** Before doing anything, checks that the outbound hypothesis is recorded — `~/.gtm-os/frameworks/installed/outreach-campaign-builder.hypothesis.json` must exist. If missing: refuses to launch and routes the user to `framework:set-hypothesis` (or setup Step 10).
2. Asks for campaign title + optional leads filter + sequence YAML + source CSV/JSON path.
3. Shells out to `campaign:create` to write the campaign row + pull qualified leads from the holding pool.
4. Shells out to `campaign:create-sequence` to draft the connect→DM1→DM2 sequence.
5. Renders both results + asks "ready to send?" — does not auto-trigger sending.
6. Suggests enabling `campaign:track` cron (or running it manually) for monitoring.

## Pre-flight (before Step 1)

### Onboarding interruption guard

```bash
test -f ~/.gtm-os/.in-flight-setup && echo "BLOCKED" || echo "OK"
```

If `BLOCKED`, stop. Tell the user to finish `yalc-gtm start` first.

### Hypothesis gate (THE critical check)

```bash
test -f ~/.gtm-os/frameworks/installed/outreach-campaign-builder.hypothesis.json && echo "OK" || echo "MISSING"
```

If `MISSING`, refuse to proceed:

> "Can't launch a LinkedIn campaign without a recorded outbound hypothesis. Either:
>
> (a) finish setup Step 10 to record one (`yalc-gtm start --review-in-chat` and re-run setup), or
>
> (b) record one directly:
> ```
> yalc-gtm framework:set-hypothesis outreach-campaign-builder \
>   --icp-segment '<segment>' \
>   --message-angle '<angle>' \
>   --signal-trigger '<signal>' \
>   --expected-reply-rate 0.05
> ```
>
> Then re-invoke me."

This guard is **enforced by the skill, not the CLI** (`campaign:create` does NOT check the sidecar today).

## Workflow

### Step 0 — Ask for inputs

One question at a time:

1. **Campaign title?** (e.g., "VP Marketing Q2 outbound — segment-fit hire signal")
2. **Lead source?** Two paths:
   - Use the holding pool of all qualified leads (default — pass no `--leads-filter`).
   - Filter to a subset via `--leads-filter '<json-shape>'` (e.g., `'{"score":{"$gte":80}}'`).
3. **Sequence YAML path?** (`--sequence <path>` — required by `campaign:create-sequence`). Usually `configs/sequences/connect-dm1-dm2.yaml` or a custom path.
4. **Source CSV/JSON?** (`--source <path>` — required by `campaign:create-sequence`). The leads file the sequence will personalize against.
5. **Optional toggles:**
   - `--linkedin-account <id>` (multi-account routing)
   - `--timezone <tz>` (default Pacific or whatever the framework default is)
   - `--start-at <date>` (default = now)
   - `--send-window '<HH:MM-HH:MM>'`
   - `--active-days <mon,tue,wed,thu,fri>`
   - `--delay-mode <natural|fast>`
   - `--dry-run` (preview without writing to Unipile)

### Step 1 — Read the hypothesis sidecar for the `--hypothesis` arg

```bash
HYPOTHESIS=$(jq -r '.message_angle' ~/.gtm-os/frameworks/installed/outreach-campaign-builder.hypothesis.json)
```

The CLI's `--hypothesis` flag accepts a string. Pass the `message_angle` so `campaign-intelligence` can score the actual reply rate against the declared expected rate later.

### Step 2 — Shell out to `campaign:create`

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts campaign:create \
    --title "<title>" \
    --hypothesis "$HYPOTHESIS"
```

(Add `--leads-filter '<json>'`, `--auto-copy`, `--segment-id`, `--timezone`, `--start-at`, `--send-window`, `--active-days`, `--delay-mode`, or `--dry-run` if the user opted in.)

Per the 0.13.0 benchmark: side-effecting commands always shell out. The CLI's `withDiagnostics()` wrapper handles env loading + tenant resolution.

### Step 3 — Parse the campaign result

The CLI prints the campaign id + initial status + the count of qualified leads pulled into the campaign. Capture all three.

On non-zero exit, surface stderr verbatim.

### Step 4 — Shell out to `campaign:create-sequence`

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts campaign:create-sequence \
    --sequence "<sequence-yaml-path>" \
    --source "<leads-csv-or-json-path>"
```

(Add `--linkedin-account <id>` or `--dry-run` if the user opted in.)

**Note:** `campaign:create-sequence` does NOT take `--campaign-id` or `--variants` flags. It reads the sequence shape from the YAML and personalizes against the source CSV/JSON. Variants are declared inside the YAML, not via CLI flag.

### Step 5 — Parse the sequence result

The CLI emits per-lead message previews + the staged sequence ids. Capture them.

### Step 6 — Render summary + ask before sending

> "Campaign `<id>` created with `<n>` qualified leads.
> Sequence drafted with `<m>` per-lead messages staged.
>
> Ready to send? Hitting yes will start the campaign tracker so messages go out on schedule. (Or run `yalc-gtm campaign:track` manually anytime.)"

**Do not run `campaign:track` yourself.** That's the `track-campaigns` skill's job (Wave 4). The user makes the call.

### Step 7 — Fallback path

If either CLI exits non-zero with a non-credential error (e.g., `campaign:create` fails because no qualified leads exist in the holding pool), surface the error verbatim and suggest:
- "Run `qualify-leads` first to populate the holding pool, then re-invoke me."

## Failure surfacing — verbatim

When either CLI exits non-zero (Anthropic 429, Unipile DSN expired, sequence YAML invalid, missing leads), paste the stderr unchanged.

## Notes

- The CLI surfaces `campaign:create` flags this way (verified): `--leads-filter <json>`, `--title <title>`, `--hypothesis <hypothesis>`, `--auto-copy`, `--segment-id <id>`, `--timezone <tz>`, `--start-at <date>`, `--send-window <range>`, `--active-days <days>`, `--delay-mode <mode>`, `--dry-run`. **No `--result-set` flag.**
- The CLI surfaces `campaign:create-sequence` flags this way (verified): `--sequence <path>` (required), `--source <path>` (required), `--linkedin-account <id>`, `--dry-run`. **No `--campaign-id` or `--variants` flag** — variants are declared in the sequence YAML.
- The hypothesis gate is intentional: prevents the misroute Step 10 of setup fixed in 0.10.0 (where "launch outbound" silently became "draft a content hook").
- 30 connects/day cap is enforced by Unipile and the campaign tracker — not by this skill.
- Dual flow: `campaign:create` writes the campaign row; `campaign:create-sequence` populates the per-lead messages. They're decoupled deliberately so you can re-stage messages without re-creating the campaign.
