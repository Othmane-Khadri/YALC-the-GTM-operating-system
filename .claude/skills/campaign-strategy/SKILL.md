---
name: campaign-strategy
description: Pre-flight strategy advisor for a new campaign. Analyses every past campaign in the local YALC DB (HeyReach campaigns auto-sync on each run), their real outbound copy, where in the sequence each conversation first replied, every prior retro brief, and the validated/proven intelligence file. Then it proposes angle, audience, batch size, channel choice, and concrete testable hypotheses for the campaign you are about to launch. Does NOT draft outbound copy — that is refine-outbound-copy's job. Use when someone says 'I want to launch a campaign for X', 'how should we approach this campaign', 'what should we test next', 'strategy for the next campaign', or 'campaign manager' in the context of building a new campaign.
---

# Campaign Strategy (pre-flight)

The forward-looking sibling of `improve-campaign`. Where improve-campaign asks "what should we change after this campaign?", strategy asks "what should we do for the next campaign, given everything we know?"

**Goal (per David's standing direction):** "Improve our campaigns constantly. The goal is not execution and completion — it's performance and results." The skill exists at the moment a new campaign is being built, because that is when analysis is most useful.

**Key idea:** the reasoning happens *in chat* — not via a duplicate API call. The CLI helpers load the raw data and persist the output; the strategic thinking happens between them.

## When this skill applies

- "I want to launch a campaign for X" / "how should we approach this campaign"
- "What should the next campaign test?"
- "Campaign manager" — when invoked while building (not after) a campaign
- "What did we learn from previous campaigns that's worth testing next?"

**Not this skill:**
- "Retro on the last campaign" / "what didn't work" → `improve-campaign`
- "Draft / rewrite the outbound copy" → `refine-outbound-copy`
- "Create the campaign now in the DB" → `campaign:create-sequence`

## Inputs

Just one: **concept** — a short description of the campaign the user wants to launch. e.g. "Reddit GEO Specialists hire", "datascalehr CHRO Tier-1 follow-up". Don't ask anything else up front.

## Procedure

### Step 0 — Guard

```bash
test ! -e ~/.gtm-os/.in-flight-setup
```

If the file exists, stop and tell the user setup is in progress.

### Step 1 — Auto-sync HeyReach (proactive — do not ask)

Per David's standing rule: if the user doesn't need to do something because you have access, do it. Before pulling data, refresh the local DB so the strategy reasons against the latest funnel + copy + reply attribution:

```bash
npx tsx src/cli/index.ts campaign:import-heyreach
```

This is idempotent and cached (5-min TTL on stats, 1-hour TTL on chatrooms), so it's cheap on re-runs. It auto-extracts the real DM copy and reply-step attribution from chatrooms via the HeyReach MCP. If the user has other senders besides David, repeat with `--sender-account-id <id>`.

Surface a one-line note ("Synced N HeyReach campaigns") so the user sees the refresh happened — don't dump the full output.

### Step 2 — Pull the strategy data block

```bash
npx tsx src/cli/index.ts campaign:strategy --data-only --concept "<one-line concept>"
```

Emits JSON with three top-level arrays plus the concept:

```json
{
  "concept": "...",
  "tenantId": "default",
  "intelligenceDir": ".../data/intelligence",
  "outputDir": ".../data/intelligence",
  "pastCampaigns": [
    {
      "id": "heyreach:412427",
      "title": "GEO/SEO Talents Batch #1",
      "hypothesis": "...",
      "funnel": { "leads": 43, "connectsSent": 42, "connectsAccepted": 24, "dmsSent": 18, "replies": 15, "acceptRate": 0.57, "replyRate": 0.83 },
      "replyAttribution": [ { "after_step": 1, "replies": 11 }, { "after_step": 2, "replies": 10 } ],
      "conversationsSampled": 18,
      "variants": [ { "name": "...", "connectNote": "...", "dm1Template": "<the real DM1 text>", "dm2Template": "<the real DM2 text>", "sends": 42, "accepts": 24, "acceptRate": 0.57, "dmsSent": 18, "replies": 15, "replyRate": 0.83 } ]
    }
  ],
  "retroBriefs": [ /* every campaign_improvement_*.json */ ],
  "intelligence": [ /* every validated/proven entry in data/intelligence/ */ ]
}
```

`dm1Template` / `dm2Template` are the real outbound messages David sent, extracted from chatrooms. `replyAttribution` shows where in the sequence each conversation first replied (`after_step: 1` = after DM1, `after_step: 2` = after DM2, etc.). The connect-request note is NOT recoverable via LinkedIn's API — if the user wants it factored in, ask them to paste it via `campaign:annotate --connect-note "..."` before continuing. Otherwise, proceed using DM1+ data only.

### Step 3 — Reason in chat (this is the work)

Read the data block and write a strategy brief that matches this shape:

```json
{
  "proposed_campaign_concept": "<echo back the concept>",
  "summary": "one-line strategic take",
  "closest_past_campaigns": [
    { "id": "heyreach:412427", "name": "...", "why_similar": "...", "headline_metric": "57% accept / 83% reply on 43 leads" }
  ],
  "what_worked_before": [
    { "observation": "...", "evidence": "...", "confidence": "hypothesis|validated|proven" }
  ],
  "what_to_carry_forward": [
    { "decision": "...", "rationale": "...", "confidence": "..." }
  ],
  "copy_devices_to_test": [
    { "device": "...", "seen_in": "<campaign id or '(new)'>", "why_might_work": "...", "confidence": "..." }
  ],
  "what_to_test": [
    { "hypothesis": "...", "test_design": "...", "rationale": "..." }
  ],
  "open_strategic_questions": [
    "one-line question the user must answer before launch"
  ]
}
```

**Reasoning rules:**

- 2–4 items in `closest_past_campaigns`. Each row needs a one-second headline metric (e.g. `57% accept / 83% reply on 43 leads`).
- 3–5 items in `what_worked_before`, anchored in `funnel` numbers, `variants[*]` metrics, and `replyAttribution`. Quote actual phrases from the extracted copy when they support the observation.
- 2–5 items in `what_to_carry_forward`. Concrete decisions only — "Use the GEO/SEO Talents DM1 device stack" not "keep the messaging similar."
- 2–5 items in `copy_devices_to_test`. **This is the highest-value output.** Identify specific phrases or structural moves in past copy whose performance is suspected (e.g. authority signal, exclusivity language, specific compensation anchor, permission-to-decline). Anchor each device to the campaign you saw it in, or mark `(new)` if proposing fresh.
- 2–4 items in `what_to_test`. Each must include a real `test_design` — "A/B variant A=all 4 devices vs B=2 devices, 50/50 split, >20pt reply-rate gap = stacking confirmed" beats "test the copy."
- 1–3 `open_strategic_questions`. Things the user *must* decide before launch (e.g. "hire or warm pool?"). One should always be the channel question if no cross-channel data exists.
- **Reply-step attribution is first-class.** When step-1 catches most replies (e.g. GTM Engineers at 22/28), DM1 is the workhorse — the next campaign's DM1 should preserve that load. When step-2 catches near-step-1 volume (e.g. GEO/SEO at 11/10), DM2 has its own devices doing work — call those out separately.
- **Confidence tagging is mandatory.** `hypothesis` is the default. `validated`/`proven` only when anchored in retro entries, multiple cross-campaign signal, or a validated/proven intelligence entry.
- **Do not draft outbound copy.** Identify devices, not lines.
- **No invented metrics.** If a number isn't in the data block, don't cite it.

### Step 4 — Save the brief

```bash
echo "$STRATEGY_JSON" > /tmp/campaign_strategy_<slug>.json
npx tsx src/cli/index.ts campaign:strategy --from-file /tmp/campaign_strategy_<slug>.json
```

The CLI validates the schema and writes `data/intelligence/campaign_strategy_<slug>_<YYYYMMDD>.json`.

### Step 5 — Render the result in chat

Show the user six sections:

- **Concept** — the one-line concept being advised on
- **Summary** — strategic take in one line
- **Closest past campaigns** — table with id, name, headline metric, why similar
- **What to carry forward** — bullets tagged `[confidence]`
- **Copy devices worth testing** — bullets: `device — seen in <campaign id> — why might work`
- **Hypotheses to test in this campaign** — `hypothesis → test design`
- **Open questions before launch** — bullets

When relevant, include a small reply-attribution table showing which step caught replies for each closest-past campaign — it's load-bearing data the user will want to see.

Then tell the user where the file landed.

### Step 6 — Follow-up offer

After rendering, offer:

> Want me to draft outbound copy for this strategy now? For a YALC tenant (client) campaign I'd route to `refine-outbound-copy`. For an Earleads-internal campaign I'll draft in chat directly against this brief and your voice rules.

If yes: chain forward. If they want to refine the strategy first, iterate in chat and re-write the file.

### Step 7 — Surface CLI failures verbatim

Print stderr unchanged. Common failure modes:

- `Strategy brief is missing field: ...` — step-3 JSON didn't match the schema.
- `--concept is required with --data-only.` — pass a concept.

## Hard rules

- **Auto-sync HeyReach before reasoning.** Proactivity is the baseline — don't ask the user to run import first.
- **Strategy never drafts the outbound copy.** That's `refine-outbound-copy` (for tenant campaigns) or in-chat drafting against voice rules (for Earleads-internal campaigns).
- **Copy-device hypotheses are first-class output.** Per the user's standing rule: surface what's worth testing next, with confidence tags, anchored to specific phrases observed in past copy.
- **Reply-step attribution is first-class.** Each closest past campaign's `replyAttribution` informs whether DM1 or DM2 is the workhorse — propagate that into the next campaign's architecture.
- **Confidence tagging is mandatory** on every observation, decision, and copy-device.
- **One brief per concept per day.** Same-day re-runs overwrite the prior file.

## Reference

- Strategy library: `src/lib/campaign/strategy.ts` (`runStrategyData`, `runStrategyWrite`)
- HeyReach importer: `src/lib/campaign/import-heyreach.ts` + `src/lib/services/heyreach.ts` (REST + MCP wrapper, auto-extracts copy + reply attribution)
- Backfill / annotate: `src/lib/campaign/annotate.ts` + `campaign:annotate` CLI (for connect-note backfill or hypothesis override)
- Past retros: `data/intelligence/campaign_improvement_*.json`
- Past strategy briefs: `data/intelligence/campaign_strategy_*.json`
- Validated intelligence: `data/intelligence/*.json` (excluding `campaign_*` prefixes)
- Sibling skills: `improve-campaign` (retro), `refine-outbound-copy` (copy rewrite), `campaign-dashboard` (visual)
