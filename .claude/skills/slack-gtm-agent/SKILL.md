---
name: slack-gtm-agent
description: Use when an operator DMs or mentions the YALC bot in Slack with a Lemlist campaign brief ("create a lemlist campaign for VPs of Eng at Series B SaaS", "spin a campaign for HR Tech managers", "draft a lemlist campaign for me"). Inbound Slack entry-point. Parses the natural-language brief, delegates to lemlist-campaign-from-icp, posts the dryrun as a Block Kit thread reply, ships the DRAFT campaign on thumbsup approval from the original sender. Enforces a per-channel one-campaign-per-hour rate limit. Never auto-starts a campaign.
version: 1.0.0
---

# slack-gtm-agent

The inbound Slack entry-point for the GTM loop. Operator DMs the bot a natural-language Lemlist brief, the agent parses it, runs the existing `lemlist-campaign-from-icp` orchestrator, posts the dryrun preview as a Block Kit thread reply, and ships a DRAFT campaign on a thumbsup reaction from the original sender. The agent never auto-starts a campaign and never calls `set_campaign_state(start)`.

## When this skill applies

The dispatcher routes any `message.im` or `app_mention` whose text contains at least one of these tokens (case-insensitive):

- `lemlist`
- `campaign`
- `icp`
- `spin a campaign` / `spin up a sequence`
- `outbound sequence`
- `draft a campaign`

Approval verbs (`/yalc approve`, `/yalc cancel`) are consumed by `slack-approval` upstream and never reach the agent.

## When invoked from Slack

This skill is Slack-native by definition, so the Slack thread is always the output surface. When the invocation prompt names a Slack channel and thread, treat THAT thread as your output surface instead of the chat. Everything that would otherwise print to the chat goes to the thread instead.

- Every progress message goes to the Slack thread via the Slack MCP (registered as `slack`). Use the tool `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts` (or `slack_reply_to_thread` for thread replies) so updates land in the same thread. There is no native message-update tool, so post a new message rather than trying to edit an existing one.
- The approval gate (the dryrun preview) is posted to the Slack thread as a short, structured preview, then you wait for either a thumbs-up reaction OR a thread reply matching `approve | ship it | looks good | go | yes` FROM THE ORIGINAL REQUESTER ONLY (the user id named in the invocation prompt, i.e. the original sender). Poll for the reply with `slack_get_thread_replies` and use `slack_add_reaction` to acknowledge receipt. Ignore approvals from anyone other than the original requester. No one else can approve on their behalf.
- The final result goes back to the thread with any artifact URLs (the Lemlist DRAFT campaign URL).

This restates the existing original-sender approval invariant in MCP-tool terms; the pipeline below is unchanged.

## Hard safety contract

1. **DRAFT only.** The agent only ever pushes campaigns in DRAFT state through `lemlist-campaign-from-icp`. The orchestrator already forbids `set_campaign_state(start)`; the agent does not bypass it.
2. **Original sender enforced.** Approval resolution is delegated to `awaitApproval(threadTs, userId, 600_000)` from `src/lib/server/slack-approval.ts`. Any other user's reaction is ignored.
3. **Per-channel rate limit.** One campaign run per channel per hour by default. The check happens before parsing, so blocked requests cost zero tokens.
4. **Reuse, never duplicate.** The agent is a thin shell around `lemlist-campaign-from-icp`. It does not re-implement ICP definition, persona routing, copywriting, or MCP calls.

## Pipeline (8 steps)

1. **Receive** `{text, channel, threadTs, userId}` from the dispatcher.
2. **Rate-limit check** via a COUNT query against `slack_approvals` filtered by `channel` and `created_at > now - 1h`. On hit, post `"Rate limit: one campaign per hour per channel. Try again in {X} minutes."` and stop.
3. **Parse the brief** into `{icp, channels, steps, campaignTitle?, leadCap?}` via the `BriefParser` (zero-temperature LLM call with a strict JSON schema). On `{error}`, post a clarification request and stop.
4. **Invoke `lemlist-campaign-from-icp`** via the `OrchestratorAdapter`. The adapter runs the full 25-stage chain (ICP definer, persona definer, sourcing, copywriting, dryrun JSON) and returns `{dryrun, pushDraftCampaign}`. Errors are surfaced verbatim; no silent retries.
5. **Render the dryrun** via `buildCampaignPreviewBlocks(dryrun)` (header, audience, personas, sequence, score, approval context) and post it as a Block Kit reply in the same thread (or post to the Slack thread via slack_post_message if invoked from Slack).
6. **Record pending approval** via `recordPending(threadTs, dryrun.runId, userId, channel)`.
7. **Await approval** via `awaitApproval(threadTs, userId, 600_000)`. On `rejected`, post the cancel notice. On `timeout`, post the timeout notice.
8. **On `approved`**, call `pushDraftCampaign()`. The thunk performs the existing orchestrator's stages 25a through 25f (`create_campaign_with_sequence`, `add_sequence_step` x2, `add_lead_to_campaign` per lead, `validate_campaign_readiness`). On success, post the Lemlist campaign URL (or post to the Slack thread via slack_post_message if invoked from Slack). On failure, surface the error.

## Brief-parsing schema (deterministic)

```json
{
  "icp": "string verbatim from user",
  "channels": ["email"],
  "steps": 3,
  "campaignTitle": "optional",
  "leadCap": "optional, max 100"
}
```

The parser is deterministic: zero temperature, strict JSON output, returns `{"error": "..."}` on uncertainty.

## Block Kit preview layout

| Block | Content |
|---|---|
| header | `Lemlist campaign preview: {campaign_title}` |
| section | `*Audience:* {n} leads, {email_coverage_percent}% with verified emails` |
| section | `*Personas:*` bullet list of `{title_pattern} ({seniority_tier}) routed to {routed_sequence_skill}` |
| section | Step 1 through 3, each with bold subject and 280-char body preview, delay annotation |
| section | `*Copy score:* X/100  *Sender:* {sender}  *Lead cap:* {N}` |
| context | `Approve with a thumbsup or reply /yalc approve {runId}. Times out in 10 minutes.` |

## Files

- `src/lib/skills/slack-gtm-agent/handler.ts` - main state machine
- `src/lib/skills/slack-gtm-agent/parse-brief.ts` - JSON-schema brief parser
- `src/lib/skills/slack-gtm-agent/rate-limit.ts` - per-channel rate limit against `slack_approvals`
- `src/lib/skills/slack-gtm-agent/types.ts` - `OrchestratorAdapter`, `SlackPoster`, `RateLimiter` contracts
- `src/lib/server/slack-dispatcher.ts` - trigger router
- `src/lib/services/slack.ts` - `buildCampaignPreviewBlocks` + `postBlockKitReply`

## What this skill does NOT do

- Does not re-implement any stage of `lemlist-campaign-from-icp`.
- Does not auto-start any campaign.
- Does not retry on MCP failures.
- Does not handle replies. The post-launch reply handler is a separate skill.
- Does not bypass approval for any user, including the bot owner.

## Acceptance criteria

1. `app_mention` with a fixture brief parses into `{icp, channels, steps}`.
2. Preview lands as Block Kit in the same thread.
3. Thumbsup from the original sender ships the DRAFT campaign.
4. Reaction from any other user does NOT ship.
5. A second campaign in the same channel within an hour is rate-limited and the orchestrator is never invoked.
6. `set_campaign_state(start)` is never called.
7. Timeout closes the window with no Lemlist call.
