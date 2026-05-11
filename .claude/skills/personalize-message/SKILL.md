---
name: personalize-message
description: "Generate a personalized outbound message (LinkedIn DM or cold email) for a single prospect by combining a template with the lead's profile, company, and recent signals. Use when the user says 'personalize this message', 'tailor this outreach to the prospect', 'rewrite this template for [name]', 'make this message more personal', or 'generate a personal opener'. Side-effecting — calls Anthropic and may pull live profile/company context via Firecrawl/Unipile/Crustdata."
version: 1.0.0
---

# Personalize Message

I'll wrap `personalize`. I'll ask for the template + target lead, validate inputs, run the CLI, and surface the personalized variant with reasoning so you can approve before sending.

## When This Skill Applies

Use this skill when the user says:

- "personalize this message"
- "tailor this outreach to the prospect"
- "rewrite this template for [name]"
- "make this message more personal"
- "generate a personal opener"

**NOT this skill** (use `qualify-leads` instead):
- "score these leads" / "qualify these leads" — that runs the 7-gate pipeline, not per-lead copy generation.

**NOT this skill** (use `launch-linkedin-campaign` instead):
- "send a LinkedIn outreach to this list" / "start the outbound" — campaign launch handles bulk personalization + sending. This skill is one lead at a time.

**NOT this skill** (use `send-cold-email` instead):
- "send this email to [name]" — sending is downstream. This skill produces the variant; you choose where it goes.

## What This Skill Does

1. Asks for the message template (or accepts pasted text inline) and the target lead (email, linkedin URL, or full record).
2. Validates inputs — template non-empty, lead resolvable.
3. Shells out to `npx tsx src/cli/index.ts personalize --template <text> --email <email>` (or with `--linkedin-url`, `--first-name`, etc.).
4. Parses the CLI output — variant text, reasoning, cost.
5. Renders the variant cleanly with a "regenerate?" affordance.

## What This Skill Does NOT

- Send the message. That's `send-cold-email` (email) or `launch-linkedin-campaign` (LinkedIn) or your manual paste-and-send.
- Generate sequences (DM1 + DM2 + follow-ups). That's `launch-linkedin-campaign --variants <n>`.
- Modify the underlying template or prompt — only the per-lead substitution.

## Pre-flight

1. **Onboarding interruption guard.** Run:
   ```bash
   test -f ~/.gtm-os/.in-flight-setup && echo "BLOCKED" || echo "OK"
   ```
   If `BLOCKED`, stop and tell the user to finish `yalc-gtm start` first.

2. Confirm cwd is `~/Desktop/gtm-os/`.

## Workflow

### Step 0 — Ask for inputs

One question at a time:

1. **What's the template?** A few sentences with placeholders the prospect's profile can fill (e.g. `{{first_name}}`, `{{company}}`). If they paste raw text, that's the `--template` value.
2. **Which lead?** Email is the default identifier (`--email <email>`). They can also pass:
   - `--linkedin-url <url>` (alternative to email)
   - `--first-name <name>` / `--last-name <name>` / `--company <name>` (manual override fields)
   - `--linkedin-account <id>` (multi-account routing)
   - `--channel <email|linkedin|any>` (default: `email`)
   - `--enrich` (pull live profile/company context before generating)
3. **Any toggles?** Ask only if volunteered:
   - `--dry-run` (preview without persisting; default behavior)
   - `--segment-id <id>` (route through a segment-specific brand voice)

### Step 1 — Validate

- Template non-empty, plausible (not just `{{first_name}}`).
- Lead identifier (email, linkedin URL, or first-name+company combo) present.
- If `--channel linkedin`, ensure a Unipile account is configured.

### Step 2 — Shell out

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts personalize --template "<text>" --email "<email>"
```

Per the 0.13.0 benchmark, single-command side-effecting skills shell out unconditionally. Anthropic API calls + optional Firecrawl/Unipile context pulls = side-effecting.

### Step 3 — Parse output

`personalize` emits the personalized variant + reasoning + cost. On non-zero exit, surface stderr verbatim.

### Step 4 — Render

Show:
- The personalized variant (verbatim)
- The reasoning trail (why this opener vs. another)
- Token cost + any context the system pulled (Firecrawl page, Unipile profile, Crustdata signals)

### Step 5 — Offer follow-ups

> "Want me to also:
> (a) regenerate with a different angle (re-run with a tweaked template)?
> (b) batch-personalize this template across a result set via the campaign launcher?
> (c) pipe this into a LinkedIn campaign via `launch-linkedin-campaign`?"

Don't run anything unless the user says yes.

## Failure surfacing — verbatim

When `personalize` exits non-zero (missing key, Anthropic 429, lead not found), paste the stderr unchanged.

## Notes

- Default channel is `email`. Switch to `linkedin` for DM-style copy.
- `--enrich` adds latency (~5s for Firecrawl + ~2s for Unipile profile) but produces dramatically more specific openers. Recommend it whenever the lead is high-value.
- The CLI's `--dry-run` is true by default — nothing gets sent. You always review before manually pasting or piping into a campaign.
