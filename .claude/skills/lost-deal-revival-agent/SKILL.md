---
name: lost-deal-revival-agent
description: "Drafts revival messages for closed-lost deals when a public company signal contradicts the original objection. Receives the signal-pair watcher's fire payload, fetches the verbatim Claap objection quote, and produces a 2-line draft that quotes it back. Default output is a HubSpot task for human review. Optional Lemlist DRAFT sequence for higher-volume tenants. Never auto-sends. Use when the user says 'revive closed-lost deals', 'set up revival agent', 'when objection X is fixed by signal Y reach out', 'lost deal revival', or schedules a closed-lost re-engagement loop. Side-effecting on each fire: reads Claap via MCP, drafts via Anthropic, writes a HubSpot task or stages a Lemlist DRAFT sequence, sends a Slack DM to the operator."
version: 1.0.0
category: outreach
---

# Lost Deal Revival Agent

Receives signal-pair fire payloads from the signal-pair watcher
(`src/lib/agents/signal-pair-watcher.ts`) when a watched company has both
a Claap-derived closed-lost objection tag and a fresh PredictLeads signal
within a 14-day window. Fetches the verbatim Claap objection quote,
drafts a tight 2-line revival message that quotes the objection back and
names the new signal change, then writes the draft to one of two
operator-chosen output targets for human review.

**You produce drafts. You do NOT send messages. You do NOT start Lemlist
campaigns. You do NOT modify Claap recordings.**

## When This Skill Applies

- "revive closed-lost deals"
- "set up revival agent"
- "when objection X is fixed by signal Y reach out"
- "lost deal revival"
- "closed-lost re-engagement loop"

**NOT this skill:**
- "send a cold email" → use `email-sequence` / `send-cold-email`
- "launch a LinkedIn campaign" → use `launch-linkedin-campaign`
- "summarize this Claap call" → use Claap's own per-call summary

## When invoked from Slack

If the invocation prompt mentions a Slack channel and thread, treat THAT Slack thread as your output surface instead of the chat. The drafted revival message and any progress notes go to the thread instead of the chat.

- Every progress message goes to the Slack thread via the Slack MCP (registered as `slack`). Use the tool `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts` (or `slack_reply_to_thread` for thread replies) so updates land in the same thread. There is no native message-update tool, so post a new message rather than trying to edit an existing one.
- Any approval gate (this skill defaults to producing a draft for human review, but if the invocation introduces a confirm-before-write step) is posted to the Slack thread as a short, structured preview, then you wait for either a thumbs-up reaction OR a thread reply matching `approve | ship it | looks good | go | yes` FROM THE ORIGINAL REQUESTER ONLY (the user id named in the invocation prompt). Poll for the reply with `slack_get_thread_replies` and use `slack_add_reaction` to acknowledge receipt. Ignore approvals from anyone other than the original requester. No one else can approve on their behalf.
- The final result goes back to the thread with any artifact URLs (HubSpot task, Lemlist DRAFT campaign).

This is additive to the existing operator Slack DM in Step 5: an explicit Slack channel and thread in the invocation prompt become the output surface for that run. The process below is otherwise unchanged.

## Invocation

This skill is invoked **two ways**:

1. **By the signal-pair watcher** (primary path). The watcher reads
   `signal_watches.orchestrator_skill_id`. Operators set that column to
   `lost-deal-revival-agent` on watches where they want this orchestrator
   to fire. The watcher then calls `skill.execute(payload, context)` with
   the `PairFiredPayload` shape:

   ```ts
   {
     watchId: string
     companyId: string         // domain
     entityName: string
     signalTypes: string[]
     signals: PairFiredSignal[] // [{ signalType, signalId, payload, lastSeenAt }]
     firedAt: string
   }
   ```

2. **Manually with `--simulate`** for end-to-end testing. The agent yaml
   at `configs/agents/lost-deal-revival-agent.yaml` documents this path.

## Config

Per-tenant config at `~/.gtm-os/lost-deal-revival.json`:

```json
{
  "version": 1,
  "output_mode": "crm_task",
  "objection_signal_map_path": "~/.gtm-os/objection-signal-map.yaml",
  "claap_tool_prefix": "mcp__claap__",
  "slack_operator_id": "<U_YOUR_SLACK_ID>",
  "hubspot_owner_id": "<HUBSPOT_OWNER_ID>",
  "lemlist_campaign_prefix": "Revival -",
  "task_due_offset_hours": 24,
  "model": "claude-sonnet-4-6"
}
```

`output_mode` values:
- `crm_task` (default) — writes a HubSpot task via the `crm-create-task`
  capability.
- `lemlist_draft` — stages a Lemlist DRAFT campaign via
  `create_campaign_with_sequence` (single-step sequence). The skill
  **never** calls `set_campaign_state(start)`. Operator reviews and
  manually starts the campaign in Lemlist if they want to send.

Required env vars (never in config):
- `CLAAP_API_KEY` — Claap MCP launch
- `HUBSPOT_API_KEY` — when `output_mode == crm_task`
- `LEMLIST_API_KEY` — when `output_mode == lemlist_draft`
- `SLACK_WEBHOOK_URL` or a registered Slack MCP user id — operator DM

## Process

### Step 1 — Validate the fire payload

Inputs from the watcher:
- `companyId`, `entityName`
- `signalTypes` (e.g. `["objection:headcount", "signal:hiring_surge"]`)
- `signals[]` (the actual rows from `company_signals`)

Load the objection-signal map at `objection_signal_map_path`. Parse the
`signalTypes` array into:
- `objection_kind` — extracted from the entry prefixed `objection:`
- `signal_kind` — extracted from the entry prefixed `signal:` (or
  whatever non-objection types remain)

If neither is present, log `malformed_payload` and exit cleanly. Do
not throw.

If `objection_kind` is present but `signal_kind` is NOT in
`map[objection_kind]`, log `mismatched_pair { objection_kind, signal_kind }`
and exit cleanly. This is a defensive check — the watcher should never
invoke us with a mismatched pair, but if it does, we must not write a
task or DM the operator.

### Step 2 — Fetch the verbatim Claap quote

Call the Claap MCP semantic search via `mcp__claap__search_meeting_recordings`
(or `mcp__claude_ai_Claap__search_meeting_recordings`, depending on which
prefix is configured).

Search query: derived from `objection_kind`. The classifier prompt at
`prompts/objection-classifier.md` is the source of truth for what
each objection_kind looks like in natural language. Use the search to
locate the closed-lost call for this company (`entityName` and
`companyId` are both candidate filters) and pull the verbatim moment
text.

If Claap returns no transcript, hard stop with `claap_no_transcript`.
Do not draft against an empty quote.

If Claap returns multiple candidate quotes, pick the highest-scoring
moment whose `type == 'objection'`. If none are typed `objection`, pick
the highest-scoring moment overall.

Pass the quote through the objection classifier prompt as a sanity
check. If the classifier returns a different `objection_kind` than the
one in the watcher payload, log `classifier_disagreement` and continue
(the watcher's tag wins for routing; we only log the disagreement for
operator visibility).

### Step 3 — Draft the 2-line revival message

Call the Anthropic client with the revival-copywriter prompt at
`prompts/revival-copywriter.md`. That prompt file is the **single
source of truth** for the revival voice. The skill code reads it from
disk at runtime and substitutes `{{company_name}}`, `{{claap_quote}}`,
`{{signal_kind}}`, and `{{signal_summary}}` into it. Do not embed a
second copy of the prompt anywhere.

Inputs:
- `company_name = entityName`
- `claap_quote`, the verbatim moment text
- `signal_kind`, the public change type
- `signal_summary`, a one-line summary of `signals[*].payload`. The
  prompt treats this as the concrete fact to anchor on if no separate
  KPI is supplied by the operator.

Voice rules baked into the prompt:
- Direct, lead with value not introduction.
- Data first, KPI driven. The draft MUST contain at least one digit
  anchoring the concrete fact from the public change summary.
- Quote the buyer back verbatim in line 1 (character-for-character).
- Name the change in line 2, tying it back to the original objection.
- Close with one specific forward-looking question (no "let me know
  your thoughts").
- One sentence max of "I noticed X" framing across the message.
- No filler words: really, very, just, actually, I think.
- No buzzwords: synergy, leverage, ecosystem, cutting-edge,
  best-in-class, game-changer.
- No em-dash, no en-dash, no ` - `. Compound hyphens inside words
  like `AI-native` are fine.
- Never starts with "I".
- Exactly 2 sentences. Hard cap.

See `prompts/revival-copywriter.md` for the 3 GOOD and 3 BAD examples
the LLM is shown.

Run the draft through `validateMessage()` from `src/lib/outbound/validator.ts`.
If any HARD rule fails, retry once with the violation echoed back to the
model. If the retry also fails, hard stop with `dash_scan_failed`.

### Step 4 — Write to the configured output target

Branch on `output_mode`:

**`crm_task` (default).** Resolve the `crm-create-task` capability via
the capability registry. Build the call:
- `subject: "Revive: " + entityName`
- `body:` the drafted 2 lines, then a blank line, then `Claap quote: "<quote>"`,
  then a line with `Signal: <signal_kind> — <signal_summary>` (use a
  colon, never a dash, to stay clean of the rail).
- `dueAt:` `now + task_due_offset_hours` as ISO-8601.
- `ownerId:` `hubspot_owner_id` from config (optional).

Capture the returned `taskId`.

**`lemlist_draft`.** Call the Lemlist MCP
`mcp__claude_ai_Lemlist__create_campaign_with_sequence` (or `mcp__lemlist__`
equivalent). Build:
- `name: "<lemlist_campaign_prefix> <entityName>"`
- A single-step sequence whose body is the drafted 2 lines.
- Status DRAFT (Lemlist creates campaigns in DRAFT by default —
  **never call `set_campaign_state(start)` after creation**).

Capture the returned `campaignId`.

### Step 5 — Send operator Slack DM

Build a plain-text message:

```
Lost deal revival drafted for <entityName>
Signal that changed: <signal_kind>

Drafted message:
<line 1>
<line 2>

Original objection: "<claap_quote>"

Output target: <HubSpot task #{taskId} | Lemlist DRAFT campaign #{campaignId}>
```

Send via the Slack delivery configured in `~/.gtm-os/lost-deal-revival.json`
or the global Slack config (or post to the Slack thread via slack_post_message
if invoked from Slack). Use the Slack service module from
`src/lib/services/slack.ts` so we share the operator's existing wiring.

### Step 6 — Emit a `result` event

Yield a `result` event with:
```ts
{
  companyId, entityName,
  objection_kind, signal_kind,
  claap_quote,
  draft: { line1, line2 },
  output_mode,
  taskId?: string,
  campaignId?: string
}
```

## Failure modes (hard stops)

- `mismatched_pair` — log and exit cleanly (NOT a hard stop, just a no-op)
- `malformed_payload` — same (no-op)
- `claap_no_transcript` — hard stop, log the company id
- `dash_scan_failed` — hard stop after retry
- `crm_create_task_failed` / `lemlist_create_failed` — hard stop
- `slack_delivery_failed` — log but do not roll back the CRM/Lemlist write

## Output Quality Bar

- Every draft literally quotes the verbatim Claap phrase.
- Every draft passes the dash-scan rail without auto-fix.
- Every draft ends with a forward-looking question (line 2).
- No assumptions. If Claap returns nothing, do not invent a quote.
- Never auto-send. Lemlist mode produces DRAFT campaigns only.

## Running on a schedule

See `references/setup.md`. The signal-pair watcher's daily run is the
primary fire path. The agent yaml at
`configs/agents/lost-deal-revival-agent.yaml` exists for the manual
`--simulate` path and operator discovery via `agent:install`.

## References

- `references/setup.md` — full operator setup walkthrough
- `prompts/revival-copywriter.md` — the atomic 2-line draft prompt
- `prompts/objection-classifier.md` — the atomic classifier prompt
- `configs/objection-signal-map.template.yaml` — the mapping table
