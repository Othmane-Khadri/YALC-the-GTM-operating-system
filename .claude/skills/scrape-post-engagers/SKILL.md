---
name: scrape-post-engagers
description: "Pull the audience that engaged with a LinkedIn post — likers (reactors) and commenters — via Unipile, dedupe across endpoints, and persist them as a result set ready for qualification or campaign launch. Use when the user says 'scrape engagers from this post', 'who liked this LinkedIn post', 'who commented on this LinkedIn post', 'pull engagers from this URL', or 'get the audience of this post'. Side-effecting — calls Unipile and writes to the local SQLite DB."
version: 1.0.0
---

# Scrape Post Engagers

I'll pull the people who engaged with a LinkedIn post (reactors + commenters) via Unipile, dedupe them across endpoints, and persist the result as a numbered result set you can hand off to `qualify-leads` or `launch-linkedin-campaign`.

## When This Skill Applies

Use this skill when the user says:

- "scrape engagers from this post"
- "who liked this LinkedIn post"
- "who commented on this LinkedIn post"
- "pull engagers from this URL"
- "get the audience of this post"

**NOT this skill** (use `qualify-leads` instead):
- "score these prospects" / "qualify these leads" — qualification runs the 7-gate ICP pipeline on an existing result set, it doesn't fetch new data.

**NOT this skill** (use `personalize-message` instead):
- "write a DM to this engager" / "personalize a message" — that's per-lead copy generation, not audience extraction.

**NOT this skill** (use `launch-linkedin-campaign` instead):
- "send connect requests to these people" / "start outreach" — campaign launch consumes a result set; it doesn't produce one.

## What This Skill Does

1. Validates the LinkedIn post URL (`linkedin.com/posts/...` or `linkedin.com/feed/update/...`).
2. Shells out to `npx tsx src/cli/index.ts leads:scrape-post --url <url>`.
3. The CLI calls Unipile under the hood, fetches reactors + commenters, dedupes them, writes them to the local SQLite DB as a fresh result set, and prints the result set id, totals, and output path.
4. Renders a clean summary and offers to chain into the next step (qualify or launch).

## What This Skill Does NOT

- Send messages, connection requests, or DMs. That's `launch-linkedin-campaign`.
- Score or filter the engagers against an ICP. That's `qualify-leads --result-set <id>`.
- Personalize copy. That's `personalize-message`.
- Edit `.env`, the Unipile DSN, or any config. Read the env, fail loudly if missing.

## Workflow

### Step 0: Ask for the LinkedIn post URL

If the user hasn't pasted a post URL, ask:

> "What's the LinkedIn post URL? I need either the activity URL (`linkedin.com/posts/<handle>_<slug>-activity-...`) or the feed update URL (`linkedin.com/feed/update/urn:li:activity:...`)."

Don't proceed without a URL. Don't guess from screenshots, post titles, or partial slugs.

### Step 1: Validate URL format

The CLI accepts any URL Unipile resolves, but the supported patterns are:

- `https://www.linkedin.com/posts/<handle>_<slug>-activity-<id>-<suffix>`
- `https://www.linkedin.com/feed/update/urn:li:activity:<id>/`

If the URL doesn't match either shape, ask the user to paste the canonical URL from the post's "Copy link" menu.

### Step 2: Shell out to the CLI

From the gtm-os root (`~/Desktop/gtm-os/`):

```bash
npx tsx src/cli/index.ts leads:scrape-post --url <url>
```

Per the 0.13.0 benchmark, single-command side-effecting skills shell out unconditionally — the import-direct path saves ~10ms but doubles the maintenance surface.

Optional flags worth surfacing if the user asks:

- `--type <both|reactions|comments>` — default `both`. Drop to `reactions` or `comments` only if the user says "just likers" / "just commenters".
- `--max-pages <n>` — default `10`. Bump only if engagement count >1000 reactors expected.
- `--account <name>` — pick a non-default Unipile account (multi-tenant only).
- `--output <path>` — override where the JSON file lands.

Don't pass these flags unless the user asks.

### Step 3: Parse the CLI output

The CLI prints a final block of the form:

```
✓ Scraped <N> engagers (<R> reactors, <C> commenters)
  Result set: <id>
  Output: <path>

Next: yalc-gtm leads:qualify --result-set <id>
```

Capture the result set id, total count, reactor count, commenter count, and output path.

### Step 4: Render a clean summary

Use the format shown in `references/example-output.md`. At minimum:

- Total engagers + breakdown of reactors vs commenters.
- Result set id (the user will need this for the next command).
- Output JSON path (so they can inspect the raw payload).

### Step 5: Offer follow-ups

After the summary, ask:

> "Want me to:
> (a) qualify these leads against your ICP via `qualify-leads --result-set <id>`?
> (b) launch a LinkedIn outreach campaign to them via `launch-linkedin-campaign`?"

Don't run either without a clear yes.

## Notes

- The CLI is gated on the `linkedin` channel being enabled in the user's config — if disabled, the CLI exits with a clear message and this skill surfaces it verbatim.
- Unipile rate limits: caps page-fetches per account-per-hour. If pagination errors mid-flight, the partial result set is still persisted; surface the result set id and tell the user they can re-run with the same URL to top up.
- Dedupe is by canonical LinkedIn profile URL — someone who both liked and commented appears once with `engagement_type` reflecting both signals.
- Never paste Unipile DSNs, account ids, or tokens into chat. They live in `~/.gtm-os/.env`.
