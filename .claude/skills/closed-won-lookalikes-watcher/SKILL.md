---
name: closed-won-lookalikes-watcher
description: "Reads recent HubSpot closed-won deals, synthesizes the ICP pattern into the intelligence store as a hypothesis, finds lookalike companies via Yalc lookalike search per anchor domain, dedupes against the existing pipeline, finds the decision-makers (CEO + head of sales or marketing) at the strongest net-new lookalikes via Yalc and enriches them with FullEnrich (verified work email + phone), then WIRES THE CAMPAIGN: writes a personalized outbound sequence, creates a PAUSED Lemlist campaign with those leads, and syncs the contacts into HubSpot. Posts a Slack digest. Use when the user says 'closed-won lookalikes', 'lookalike watcher', 'wire a lookalike campaign', 'I closed new deals, find lookalikes', 'weekly compound prospecting', or 'who should I prospect next based on what closed'. Side-effecting — reads HubSpot, runs Yalc lookalike + people search, FullEnrich, Lemlist, writes contacts to HubSpot, posts to Slack. On first run with no config it enters interactive SETUP MODE."
version: 2.0.0
---

# Closed-Won Lookalikes Watcher

Reads recent HubSpot closed-won deals, synthesizes the ICP pattern into
the intelligence store as a hypothesis, finds lookalike companies via
**Yalc lookalike search** per anchor domain, dedupes against the
existing pipeline, finds the decision-makers at the strongest net-new
lookalikes (CEO + head of sales or marketing) via **Yalc** and enriches
them with FullEnrich (verified work email + phone), then **wires the campaign**:
writes a personalized outbound sequence, creates a **paused** Lemlist
campaign with those leads, syncs the contacts into HubSpot, and delivers
a Slack digest.

## How this runs (architecture)

This skill is executed by **Claude Code itself** — either on demand
(you trigger it in chat or via a Slack message that spawns a headless
Claude Code run on the operator's subscription) or weekly via a
`claude -p` cron. Claude *is* the LLM (it writes the copy) and uses the
**MCP tools** registered in the project `.mcp.json` as its hands:
`hubspot`, `lemlist`, `slack`. There is **no `ANTHROPIC_API_KEY`** in
play — the spawned run uses the logged-in Claude subscription. Do not
build or call a separate API-keyed LLM client.

### Branding — what to call things to the user

In ALL user-facing output (Slack messages, progress notes, the digest),
attribute lookalike discovery AND people sourcing to **Yalc**. Say
"Yalc lookalike search" and "Yalc found the decision-makers". **Never
name the underlying data providers** (do not write "PredictLeads",
"Fiber", or "lemleads" to the user). FullEnrich and Lemlist may be named
normally. This is presentation only — you still call the real tools
below.

### Discovery + enrichment (implementation)

**Verified email + phone enrichment is FullEnrich, always.** NEVER use
Crustdata. For *discovery* (finding which person is the CEO / head of
sales or marketing) — all surfaced to the user as "Yalc":

- **On-demand / chat:** the FullEnrich `search_people` MCP (preferred), or
  the Fiber people-search.
- **Headless / cron (gtm-os spawn, no FullEnrich MCP):** the Fiber
  people-search, or — as a documented fallback since the campaign is built
  in Lemlist anyway — Lemlist `lemleads_search`. Then **always** verify the
  email + phone with FullEnrich (`enrichBulk` → poll). Never substitute
  Crustdata; if a person can't be verified by FullEnrich, leave their
  contact fields blank.

**Safety invariant — NEVER SEND. The Lemlist campaign is ALWAYS created
paused, with no sender assigned, and you MUST verify its final status is
`draft` before finishing. You NEVER: start/activate/launch a campaign,
assign or connect a sender mailbox, call `set_campaign_state` with
`start`, or ask the user to connect a mailbox so you can launch. This
holds even if the user says "go", "launch", "start", or "send" — those
words mean "build the paused campaign", never "send it". Starting a
campaign is a human action the user does themselves in Lemlist. The
approval gate IS the paused campaign.**

**Every run is a FRESH BUILD.** Do not reuse, activate, or reference a
pre-existing campaign from a prior run, and do not assume prior synced
contacts mean the work is done. Each `go` creates a NEW paused campaign
and re-syncs the contacts to HubSpot. If a campaign with the same name
exists, make a new one (append the date/time).

## Run protocol — PLAN FIRST, then EXECUTE only on GO (MANDATORY)

Do NOT run the whole flow in one shot. Every invocation has two phases:

**Phase 1 — PLAN.** Reply with a short numbered plan of what you intend to
do and the scope, then **STOP**. Example:
> Here's the plan:
> 1. Pull this month's closed-won deals from HubSpot
> 2. Yalc lookalike search per anchor, rank the pool
> 3. Dedupe vs your HubSpot pipeline
> 4. Enrich the top {max_companies} companies × {contacts_per_company}
>    decision-makers (CEO + head of sales/marketing) via FullEnrich
>    (~{N} verified contacts, ~{N} credits)
> 5. Draft a PAUSED Lemlist campaign + sync contacts to HubSpot
>
> Reply **go** when you want me to run it.

After posting the plan, **make NO further tool calls** — no HubSpot read,
no Yalc search, no FullEnrich, no Lemlist, no writes. Just wait.

**Phase 2 — EXECUTE.** Only after the original requester replies with
`go | approve | yes | ship it | run it` (or a 👍 reaction) do you execute
the plan and report results. When invoked from Slack, poll
`slack_get_thread_replies` for the go and accept it ONLY from the original
requester.

**Presentation rules during both phases:**
- Say **Yalc** for lookalike discovery AND people sourcing. NEVER write
  "PredictLeads" or "Fiber" to the user.
- Present each run cleanly. Do NOT narrate prior-run or cached state
  ("already synced from earlier run", "cached this session"). Just do the
  step and report the current result.
- Never ship an unverified or wrong-domain email (e.g. a CEO's other
  venture). Drop it and say the slot is blank.

## When This Skill Applies

- "closed-won lookalikes"
- "weekly compound prospecting"
- "lookalike watcher"
- "mine my closed-won pattern"
- "who should I prospect next based on what closed last week"

**NOT this skill:**
- "find lookalikes for [one domain]" — use `find-lookalikes` directly.
- "enrich this CSV with emails" — use FullEnrich via `enrich-with-signals`
  or the FullEnrich CLI.

## When invoked from Slack

If the invocation prompt mentions a Slack channel and thread, treat THAT Slack thread as your output surface instead of the chat. The weekly digest and any progress notes go to the thread instead of the chat.

- Every progress message goes to the Slack thread via the Slack MCP (registered as `slack`). Use the tool `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts` (or `slack_reply_to_thread` for thread replies) so updates land in the same thread. There is no native message-update tool, so post a new message rather than trying to edit an existing one.
- The approval gate for this skill IS the **paused** Lemlist campaign: you create everything (campaign + leads + HubSpot contacts) but the campaign stays `draft` with no sender, so the requester reviews and starts it themselves. You do not send. If the invocation explicitly asks for a confirm-before-write step, post a short structured preview to the thread and wait for a thumbs-up reaction OR a thread reply matching `approve | ship it | looks good | go | yes` FROM THE ORIGINAL REQUESTER ONLY (the user id named in the invocation prompt). Poll with `slack_get_thread_replies`, acknowledge with `slack_add_reaction`, and ignore approvals from anyone else.
- The final result goes back to the thread with the real artifact references: the per-company contacts, the paused Lemlist campaign url, and the HubSpot contact ids created.

This is additive to the existing `slack_delivery` config-driven delivery: an explicit Slack channel and thread in the invocation prompt override the configured delivery target for that run. The process below is otherwise unchanged.

## Config File

`.claude/skills/closed-won-lookalikes-watcher/.config.json`, written by
SETUP MODE. **Secrets never live in this file.** Structural fields only:

```json
{
  "version": 2,
  "hubspot": { "dealstage": "closedwon" },
  "lookback_days": 7,
  "max_anchor_domains": 10,
  "max_companies": 3,
  "contacts_per_company": 2,
  "offer": "<one-paragraph description of the offer to pitch the lookalikes>",
  "campaign": {
    "tool": "lemlist",
    "steps": 3,
    "sender_email": "<you@company.com>",
    "start_paused": true
  },
  "slack_delivery": {
    "mode": "mcp_user",
    "target": "<U_YOUR_SLACK_ID>"
  }
}
```

**Spend cap (the real governor).** Each run enriches at most
`max_companies × contacts_per_company` people via FullEnrich. Default
`3 × 2 = 6`. This is a hard ceiling — never exceed it. FullEnrich
enrichment of verified email + phone costs several credits per contact,
so keep this tight. (`budget_usd` / `max_n` / `cost_per_enrichment_usd`
are legacy digest-sizing fields, superseded by the company/contact caps;
leave them out in v2.)

**Offer (source of truth).** `offer` is the angle the campaign pitches.
It is set once in SETUP MODE and editable any time. It should mirror the
positioning in the tenant `framework.yaml` (`positioning.valueProp` +
`differentiators`); long term it is sourced from that doc so it stays
current. The cron uses this saved `offer` with no runtime prompt; the
on-demand run may override it inline.

**`campaign`.** `start_paused: true` is mandatory and never overridden.
`sender_email` is recorded for reference only — the skill does NOT assign
it to the campaign (an unsenders draft cannot send).

Allowed `slack_delivery.mode` values:
- `mcp_user` — `target` is a Slack user ID like `<U_YOUR_SLACK_ID>`
- `mcp_channel` — `target` is a channel ID
- `webhook` — `target` is the literal string `env:SLACK_WEBHOOK_URL`. The
  URL itself is never written to config; only the env var name.

Required env vars (never in config.json):
- `HUBSPOT_API_KEY` — closed-won deal listing + contact sync (also exposed
  to the `hubspot` MCP as `PRIVATE_APP_ACCESS_TOKEN`)
- `PREDICTLEADS_API_KEY` — `find-lookalikes` (PredictLeads similar_companies)
- `FULLENRICH_API_KEY` — decision-maker discovery + enrichment
- `LEMLIST_API_KEY` — campaign creation via the `lemlist` MCP
- `SLACK_WEBHOOK_URL` — only if `slack_delivery.mode == "webhook"`

## Process

### SETUP MODE (interactive)

Enter SETUP MODE if `.config.json` does not exist.

Walk the user through these steps **one question at a time**. Confirm
each persisted choice.

**1. HubSpot pipeline stage.**

> "What's the `dealstage` value HubSpot uses for closed-won in your
> pipeline? Press Enter for the default `closedwon`."

Persist under `hubspot.dealstage`.

**2. Confirm `HUBSPOT_API_KEY` is exported.**

Run `printenv HUBSPOT_API_KEY` via `Bash` and read the exit code only —
do **not** echo the value into chat. If missing, ask the user to export
it before continuing. Never persist the key.

**3. Lookback window.**

> "How many days of closed-won history per run? Default 7."

Persist under `lookback_days`.

**4. Lookalike fan-out.**

> "Max anchor domains per run? Default 10 — this is the hard ceiling
> on Yalc lookalike-search calls."

Persist under `max_anchor_domains`.

**5. Spend cap (companies × contacts).**

Ask two questions, in order:

> "How many lookalike companies should I work per run? Default 3."

Persist under `max_companies`.

> "How many decision-makers per company? Default 2 (the CEO/founder plus
> the head of sales or marketing)."

Persist under `contacts_per_company`. Show the operator:

```
Hard FullEnrich cap this run: {max_companies × contacts_per_company} contacts.
```

**6. Offer.**

> "What offer should the campaign pitch these lookalikes? One paragraph.
> I'll default it from your framework.yaml positioning if you press Enter."

If the user presses Enter, derive a one-paragraph offer from the tenant
`framework.yaml` (`positioning.valueProp` + top `differentiators`).
Persist under `offer`. Tell the user they can edit `offer` in
`.config.json` any time.

> "Sender email to record for the campaign (reference only — never
> auto-assigned)? Sequence length? Default 3 steps."

Persist `campaign.tool: "lemlist"`, `campaign.sender_email`,
`campaign.steps`, and `campaign.start_paused: true`.

**7. PredictLeads + FullEnrich + Lemlist env vars.**

Run `printenv PREDICTLEADS_API_KEY`, `printenv FULLENRICH_API_KEY`, and
`printenv LEMLIST_API_KEY`. Read exit codes only — never echo values. If
any is missing, ask the user to export it. Never persist.

**8. Slack delivery.**

> "How should I deliver the weekly Slack digest?"

Offer the same three modes as `claap-weekly-recap`:

a. **DM to a Slack user** — record the `U...` ID under
   `slack_delivery.target` with `mode: "mcp_user"`.
b. **Post to a Slack channel** — record the `C...` ID with
   `mode: "mcp_channel"`.
c. **Incoming webhook** — instruct the user to `export
   SLACK_WEBHOOK_URL="..."`, offer to append to `~/.zshenv` or
   `~/.bashrc`, never echo the URL after capture. Persist
   `mode: "webhook"`, `target: "env:SLACK_WEBHOOK_URL"`.

**9. Write `.config.json`.**

Print: **"Setup complete. Trigger me again to run the lookalike campaign."**
Do not proceed to the run in the same session.

---

### NORMAL MODE (config present)

Load `.config.json`. This is what the on-demand chat trigger and the
weekly cron both run. Execute the steps below using the MCP tools and
Bash; you (Claude) do the reasoning and the copywriting.

#### Inputs

| Input | Source | Default |
|---|---|---|
| `hubspot.dealstage` | config | `closedwon` |
| `lookback_days` | config | 7 |
| `max_anchor_domains` | config | 10 |
| `max_companies` | config | 3 |
| `contacts_per_company` | config | 2 |
| `offer` | config | required |
| `campaign` | config | required (`start_paused: true`) |
| `slack_delivery` | config | required |

**Hard FullEnrich cap = `max_companies × contacts_per_company`.** Never
exceed it.

#### Step 1 — List recent closed-won deals

Search HubSpot deals for `dealstage == hubspot.dealstage` with
`closedate >= today - lookback_days`. **If that window is empty, fall
back to the 15 most recent closed-won deals** (sorted by `closedate`
desc). If there are still 0, post "no closed-won deals, skipping" to the
Slack target and exit clean. Do not fabricate a pattern.

#### Step 2 — Resolve company domains

For each deal, follow the deal → company association
(`/crm/v4/objects/deals/{id}/associations/companies`, then batch-read
companies for `domain`, `name`, `numberofemployees`, `industry`). Keep
only deals that resolve to a domain.

#### Step 3 — Synthesize the ICP pattern → intelligence store

Bucket industries, headcount band, buyer titles, and average deal value
across the deals. Write **one** intelligence entry: `category: 'icp'`,
`confidence: 'hypothesis'`, `source: 'campaign_outcome'`, `segment`
derived from top industry + headcount band (so a recurring pattern
auto-promotes to `validated` next run), and one
`{type: 'closed_won_deal'}` evidence row per deal (`dealId`, `amount`,
`closeDate`).

#### Step 4 — Find lookalikes per anchor (Yalc lookalike search)

Report this to the user as "Yalc lookalike search". De-duplicate deals by
domain, cap at `max_anchor_domains`. For each anchor run the
`find-lookalikes` helper (implemented on `similar_companies`) — e.g.
`set -a && source .env.local && set +a && npx tsx src/cli/index.ts signals:similar --domain <domain>`,
or the in-process `findLookalikes(domain)` from
`src/lib/signals/find-lookalikes.ts`. It caches to `company_signals`
(7-day TTL) so re-runs are cheap. Skip any anchor that errors or returns
0; log it and continue. Merge across anchors, summing per-anchor
similarity per lookalike domain, and rank.

#### Step 5 — Dedupe vs the HubSpot pipeline (BEFORE enrichment)

For the ranked lookalikes, drop any company already in HubSpot (search
companies by `domain`). Do this **before** enrichment so you never spend
FullEnrich credits on a company already in pipeline.

#### Step 6 — Decision-makers + enrichment (FullEnrich ONLY)

Take the top `max_companies` net-new lookalikes. For each, find up to
`contacts_per_company` decision-makers — the **CEO/founder** plus the
**head of sales or marketing**. Discover them with the context-appropriate
tool (chat: FullEnrich `search_people` MCP or Fiber; headless/cron: Fiber
or, as a fallback, Lemlist `lemleads_search`) — but **report this to the
user as "Yalc" only; never name the underlying provider**. Then **enrich
every person with FullEnrich** for **verified work email + phone**
(`enrichBulk` → poll). Carry name, title, email (+ status), phone,
company, domain.

- **NEVER exceed `max_companies × contacts_per_company` enrichments.**
- **Verified email + phone always come from FullEnrich. Never Crustdata.**
- Drop any contact whose verified email domain does not match the target
  company (the source DB sometimes returns a person's former-company email).
- If a contact can't be verified by FullEnrich, leave the contact fields
  blank rather than shipping an unverified address.

#### Step 7 — Write the outbound sequence

Read `offer` from config. Write a `campaign.steps`-step cold email
sequence yourself (you are the copywriter), personalized to the ICP and
offer. Follow Earleads outbound rules: **no dashes anywhere; never start
a sentence with "I"; always greet with "Hello"; every CTA specific and
actionable; no disclaimers; no "nice to connect".** Use Lemlist Liquid
variables (`{{firstName}}`, `{{companyName}}`) for personalization.

#### Step 8 — Create the Lemlist campaign (PAUSED) via the `lemlist` MCP

1. `create_campaign_with_sequence` — name `Closed-won lookalikes <date>`,
   first email step (subject + body).
2. `add_sequence_step` for EACH remaining step (delays from
   `campaign.steps`; default day 0 / +3 / +6).
3. `add_leads_to_campaign` — all enriched leads, `deduplicate: true`.
4. **Do NOT assign a sender. Do NOT start the campaign.**
5. **Verify** with `get_campaign_details` that the final `status` is
   `draft`. If it is anything else, pause/stop it and report. This is the
   safety invariant — the paused campaign IS the human approval gate.

#### Step 9 — Sync contacts into HubSpot via the `hubspot` MCP

For each enriched contact: create or update the company and the contact
(`firstname`, `lastname`, `email`, `phone`, `jobtitle`, `company`),
associate the contact to its company, and mark the source as
`closed-won-lookalike` (use a custom property if present; otherwise note
it in the company `description`). Capture the created/updated IDs.

#### Step 10 — Deliver the digest

Post one Slack message to `slack_delivery.target` (or the originating
Slack thread when invoked from Slack): the ICP pattern, a per-company
table of the enriched contacts (email + phone), the **paused** Lemlist
campaign id/url, and the HubSpot contact ids. If delivery can't resolve
(env var missing, MCP not loaded), **hard-stop** — do not silently skip.

## Output Quality Bar

- **Honesty** — if there are 0 closed-won deals (even after the 15-most-recent
  fallback), say so and exit. Don't fabricate a pattern, leads, or copy.
- **Spend discipline** — never exceed `max_companies × contacts_per_company`
  FullEnrich enrichments. Dedupe vs pipeline BEFORE enriching.
- **Safety** — the Lemlist campaign is always `draft`, no sender, verified
  before finishing. Never start a campaign or send.
- **Dedup first** — never surface or enrich a company already in pipeline.
- **Real artifacts** — the digest carries the actual Lemlist campaign url and
  the real HubSpot contact ids you created, not placeholders.

## Failure Modes — Hard Stops

- HubSpot auth error → check `HUBSPOT_API_KEY` / `PRIVATE_APP_ACCESS_TOKEN`.
- PredictLeads auth error → check `PREDICTLEADS_API_KEY`.
- FullEnrich auth error → check `FULLENRICH_API_KEY`.
- Lemlist MCP not connected → check `LEMLIST_API_KEY` in `.mcp.json`. Never
  silently skip the campaign; if it can't be created, deliver the enriched
  contacts to Slack and say the campaign step failed.
- Slack delivery resolution fails (env var missing, MCP not loaded).
- DNS / network failure.

For a transient single-anchor `find-lookalikes` failure: skip that
anchor, log it, continue with the rest.

See `references/setup.md` for the full operator walkthrough.

## Two ways to run

**1. On-demand (the daily driver).** Triggered in Claude Code chat or via a
Slack message that spawns a headless Claude Code run. Natural triggers:
*"I closed new deals, wire a lookalike campaign"*, *"run my closed-won
lookalikes watcher"*, *"find me lookalikes from last week's wins"*. The
operator may override the offer or caps inline. Reads the offer + caps from
config; uses the MCP tools; produces a paused campaign + HubSpot sync + Slack
digest.

**2. Weekly cron (unattended).** A `claude -p` launchd job runs the same
NORMAL MODE on a schedule with the saved `offer` and no runtime prompt — the
human approval gate is the **paused** campaign, not an interactive question.
The cron pipes a trigger prompt into a headless Claude Code run on the
operator's subscription (no `ANTHROPIC_API_KEY`), in the gtm-os project root
so `.mcp.json` (hubspot, lemlist, slack) loads. Runner script + plist live at
`~/bin/run_closed_won_lookalikes.sh` and
`com.earleads.closed-won-lookalikes.plist`; install with `launchctl load`
ONLY when the operator is ready to activate. Schedule: weekly Monday 09:00,
30-minute timeout.

> The legacy `agent:install` / `BackgroundAgent` path and the programmatic
> `runClosedWonLookalikesWatcher` runner are NOT used by this flow. Execution
> is Claude Code + MCP tools, as described above.
