---
name: signal-to-call
version: 1.0.0
description: "Use when the user says 'turn this job posting into a cold call', 'agent 1 from this signal', 'signal to call for [URL]', 'spin a verified mobile + 12h task from this hire', 'one prompt from job url to HubSpot task', or any variant indicating they want a hiring signal converted into a verified-mobile contact in HubSpot, a 12 hour cold-call task with a pre-drafted opener, and a Slack DM. Orchestrates qualify-leads (dry run), the framework persona resolver, the Fiber people-search adapter, the FullEnrich people-enrich adapter, and the HubSpot crm-contact-upsert / crm-attach-note / crm-create-task manifests, then dispatches a Slack DM via src/lib/services/slack.ts. Hard approval gate before the HubSpot push. Never auto-pushes."
---

# Signal to Call

One prompt in (a public job posting URL), one verified-mobile cold call out: HubSpot contact + signal note + 12 hour cold-call task with a pre-drafted opener, plus a Slack DM to the operator. Hard approval gate before any HubSpot or Slack write. Dryrun JSON for audit. No auto-send.

The user types one prompt. The skill chains qualify-leads (dry run), the framework persona resolver, Fiber people-search, FullEnrich people-enrich, and three HubSpot capability manifests. Approval gates fire before the HubSpot push. Nothing auto-sends.

## When This Skill Applies

- "turn this job posting into a cold call"
- "agent 1 from this signal"
- "signal to call for [URL]"
- "spin a verified mobile + 12h task from this hire"
- "one prompt from job url to HubSpot task"

**NOT this skill** (use `qualify-leads` instead):
- "qualify these leads" / "score this list" - that is the 7 gate pipeline by itself.

**NOT this skill** (use `lemlist-campaign-from-icp` instead):
- "build a campaign from this ICP" - that is the campaign orchestrator, not a one shot cold call.

## When invoked from Slack

If the invocation prompt mentions a Slack channel and thread, treat THAT Slack thread as your output surface instead of the chat. Everything that would normally print to the chat goes to the thread instead.

- Every progress message goes to the Slack thread via the Slack MCP (registered as `slack`). Use the tool `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts` (or `slack_reply_to_thread` for thread replies) so updates land in the same thread. There is no native message-update tool, so post a new message rather than trying to edit an existing one.
- Every approval gate (the dryrun summary and the hard approval prompt) is posted to the Slack thread as a short, structured preview, then you wait for either a thumbs-up reaction OR a thread reply matching `approve | ship it | looks good | go | yes` FROM THE ORIGINAL REQUESTER ONLY (the user id named in the invocation prompt). Poll for the reply with `slack_get_thread_replies` and use `slack_add_reaction` to acknowledge receipt. Ignore approvals from anyone other than the original requester. No one else can approve on their behalf.
- The final result goes back to the thread with any artifact URLs (HubSpot contact record, HubSpot task, and the operator Slack DM target).

The orchestration logic below is unchanged; only the output surface moves to the Slack thread when a channel and thread are present in the invocation prompt.

## Prerequisites

```
FIBER_API_KEY=         # https://fiber.ai -> API
FULLENRICH_API_KEY=    # https://fullenrich.com -> API
HUBSPOT_API_KEY=       # Private App token (https://developers.hubspot.com/docs/api/private-apps)
SLACK_WEBHOOK_URL=     # Operator DM channel (used by src/lib/services/slack.ts)
```

The Fiber adapter is wired via `configs/adapters/people-search-fiber.yaml`. The HubSpot manifests live at `providers/manifests/crm-contact-upsert/hubspot.yaml`, `providers/manifests/crm-attach-note/hubspot.yaml`, `providers/manifests/crm-associate-note-to-contact/hubspot.yaml`, `providers/manifests/crm-create-task/hubspot.yaml`, and `providers/manifests/crm-associate-task-to-contact/hubspot.yaml`. The FullEnrich enrichment uses the `people-enrich` capability with provider `fullenrich` (adapter: `src/lib/providers/adapters/people-enrich-fullenrich.ts`).

This skill reads from `loadFramework(tenantId)` in `src/lib/framework/context.ts` to pick the persona segment that owns the posted role. The tenant defaults to `default` unless `GTM_OS_TENANT` is set.

## Hard safety contract (MANDATORY)

This skill creates a contact, a note, and a task in a real HubSpot account, and sends a Slack DM. It must never auto-fire. Safeguards mirror `lemlist-campaign-from-icp` verbatim:

1. **DRAFT-default analogue.** Nothing exists in HubSpot until approval. The skill MUST NOT call `crm-contact-upsert`, `crm-attach-note`, `crm-create-task`, or `sendSlackNotification` before the operator types `approve`. The dryrun output is the analogue of lemlist DRAFT state for this CRM domain.
2. **Dryrun first.** Render the full payload (signal context, persona, resolved contact, opener text, 12h SLA, HubSpot call plan) to a local JSON file at `~/.gtm-os/signal-to-call/dryrun-{timestamp}.json`. Quote the file path back to the user.
3. **Contact ceiling.** Exactly one contact per signal. Hard cap. The skill always quotes the resolved contact name + company back before approval.
4. **Hard approval prompt.** After the dryrun, the skill asks `"Push contact + 12h task to HubSpot and send the Slack DM? Type 'approve' to proceed, anything else to abort."` Block on the user response. Do not call any HubSpot or Slack tool until the user types `approve`.
5. **No silent retries.** If any HubSpot capability call fails, surface the error and stop. Do not retry without explicit user instruction.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS produce the dryrun output first.
2. Quote the EXACT contact name and company back to the user.
3. WAIT for explicit user `approve` before calling any HubSpot capability or `sendSlackNotification`.
4. Only proceed past dryrun after the user has approved in this conversation.

## Stage handoff contract

Each stage produces a structured artifact threaded forward. If a field cannot be extracted, apply the fallback. Never reach the approval prompt with empty `contact.email` AND empty `contact.phone`.

| Stage | Step | Field(s) to extract | Fallback if missing |
|---|---|---|---|
| 1 | Parse input | `company_domain`, `role`, `posted_at?` | If URL parse fails, ask the user once for `{domain, role}` |
| 2 | `qualify-leads --dry-run` | `verdict` ('pass'/'fail'), `failed_gate?` | If qualifier errors, treat as `pass` and add a note in dryrun `qualify.failed_gate = 'qualifier_error'` |
| 3 | `loadFramework` persona match | `segment_id`, `segment_name`, `seniority` | If no segment claims the role, halt with `persona_unresolved` |
| 4 | Fiber `people-search` | `firstname`, `lastname`, `linkedin_url`, `company` | If 0 results, halt with `no_contact_found` |
| 5 | Take top match | top hit with non-empty `linkedin_url` | If all results lack `linkedin_url`, halt with `no_contact_found` |
| 6 | FullEnrich `people-enrich` | `email`, `email_status`, `phone` | If `phone` empty: set `phone_unavailable_reason: 'fiber_eu_coverage_gap'`, proceed with email only |
| 7 | Draft opener | single line, dash-scan-clean | Regenerate once; second failure halts with `opener_failed_validation` |
| 8 | Compute `dueAt` | ISO-8601 UTC string: `min(now+12h, next business day 09:00 prospect-local)` | Never fails (deterministic) |

## End-to-end orchestration (9 stages)

### Stage 1 - Parse the signal

Accept either a job posting URL string or a JSON payload `{ company_domain, role, posted_at?, url }`. From a raw URL:
- `company_domain`: host (or path segment for ATS hosts like `boards.greenhouse.io/<company>/...`).
- `role`: slug-to-words on the last path segment (e.g. `vp-engineering` -> `VP Engineering`).
- `posted_at`: only if present in the payload; the skill does not fetch the page.

If the URL cannot be parsed, ask the user once: "I could not parse the company or the role from the URL. Send `{domain, role}` as a JSON payload." Then continue.

### Stage 2 - Qualify (dry run)

Shell out using the inline single-lead flags so nothing touches disk:

```bash
cd ~/Desktop/gtm-os && set -a && source .env.local && set +a && \
  npx tsx src/cli/index.ts leads:qualify \
    --company "<company_domain>" \
    --role "<role>" \
    --dry-run
```

`--company` + `--role` builds an in-memory single-record result set inside the CLI. No tempdir JSON file. Parse the verdict from the CLI output. If `fail`, halt with a one paragraph message naming the failed gate.

### Stage 3 - Resolve the persona

Call `loadFramework(tenantId)` from `src/lib/framework/context.ts`. Iterate the framework's `segments[]`. For each segment, check whether the posted `role` matches in priority order:
1. Exact case-insensitive hit in `segment.targetRoles[]` or `segment.keyDecisionMakers[]`.
2. Loose keyword overlap (any token from the role in any target role).

Pick the first matching segment. Derive `seniority` from the role title:
- `VP*`, `SVP*`, `Chief*`, `Head of*` -> `executive`
- `Manager*`, `Director*` -> `manager`
- else -> `ic`

If no segment claims the role, halt with `persona_unresolved` and surface the framework's segment names so the user can decide whether to update the framework.

See `references/executive-resolution.md` for the resolution rules in detail.

### Stage 4 - Find the right person via Fiber

Invoke the `people-search` capability with provider `fiber`. Payload shape (per `configs/adapters/people-search-fiber.yaml`):

```
{
  query: "<role> at <company>",
  company_name: "<resolved company name or domain>",
  title: "<role>",
  limit: 3
}
```

The adapter targets Fiber's REST `/v1/nlp-search/run` (the v2 MCP endpoint
returns HTTP 406 against a plain JSON POST - see the adapter header).
`query` is the only field the endpoint consumes for the search; keep it a
single-company natural-language string (`"<role> at <company>"`) so the
NLP parser does not drop the company. `limit` maps to `pageSize` (3 is
enough; each returned row costs ~1 credit on top of a 2-credit parse).

Take the first result with a non-empty `linkedin_url` **and a non-redacted
surname**. Rows with a redacted last name (e.g. `"K."`) cannot be enriched
or upserted, so skip them. If zero usable results, halt with
`no_contact_found`.

### Stage 5 - Top match

Capture `firstname`, `lastname`, `linkedin_url`, `company` from the chosen Fiber result. Thread forward to stage 6.

### Stage 6 - Verify the mobile via FullEnrich

Invoke the `people-enrich` capability with provider `fullenrich`. Payload:

```
{
  contacts: [{
    firstname: <stage 5 firstname>,
    lastname: <stage 5 lastname>,
    company_name: <stage 5 company>,
    linkedin_url: <stage 5 linkedin_url>
  }]
}
```

Read the first result's `email`, `email_status`, `phone`. If `phone` is empty:
- Set `phone_unavailable_reason: 'fiber_eu_coverage_gap'` in the dryrun and the Slack DM.
- Continue with email only. Do NOT fall back to any other provider in v1.0.0.
- If `email` is ALSO empty, halt with `enrichment_failed`.

### Stage 7 - Draft the opener

Generate a single-line opener using the template at `references/executive-resolution.md`. Validation:
1. Run the opener through `OUTBOUND_RULES.find(r => r.id === 'no-dash-punctuation').check(opener)`. Must return `true`.
2. Also run it through `OUTBOUND_RULES.find(r => r.id === 'start-with-hello').check(opener)`. The opener is a phone-call opener, not a written DM, so the `start-with-hello` rule is treated as optional - log if it fails but do not halt.

On dash-scan failure: regenerate once with a stricter prompt. Second failure -> halt with `opener_failed_validation`.

### Stage 8 - Compute the 12 hour SLA (business-hours-aware)

The SLA shifts to the next business morning in the prospect's local timezone, capped at 12 hours from signal arrival:

```
dueAt = min(now + 12h, next business day 09:00 in the prospect's local tz)
```

The prospect's timezone is derived from the country code on the Fiber result's `location` field (US, UK, DE, FR, NL, ES, IT, SE, CA, AU). Unknown country defaults to `America/New_York`.

Concrete behavior:
- Signal during local business hours (Mon-Fri 06:00-18:00): the 12-hour ceiling wins, no shift.
- Signal evening (Mon-Fri 18:00-21:00): usually the 12-hour ceiling still wins because 09:00 the next morning is more than 12h out; otherwise next-day 09:00 wins.
- Signal overnight (21:00-06:00) or on a weekend: next business day 09:00 local wins (12h would land in the middle of the night or weekend).

The ISO string is what goes into HubSpot. The human string is only for the chat summary. See `references/executive-resolution.md` -> "Business-hours SLA" for the full rule.

### Stage 9 - Dryrun, approve, push

**9a. Render the dryrun JSON to** `~/.gtm-os/signal-to-call/dryrun-{timestamp}.json`:

```
{
  "signal": { "source_url", "company_domain", "role", "posted_at" },
  "qualify": { "verdict", "failed_gate" },
  "persona": { "segment_id", "segment_name", "seniority" },
  "contact": {
    "firstname", "lastname", "company", "linkedin_url",
    "email", "email_status", "phone",
    "phone_unavailable_reason"
  },
  "opener": "<single-line text>",
  "task": {
    "subject": "Call <firstname> re: <role>",
    "due_at_iso": "<ISO-8601 UTC>",
    "due_at_human": "<rendered for chat>"
  },
  "slack": { "channel": "<operator DM>", "preview": "<the DM body>" },
  "hubspot_calls_planned": [
    { "capability": "crm-contact-upsert", "provider": "hubspot" },
    { "capability": "crm-attach-note", "provider": "hubspot" },
    { "capability": "crm-associate-note-to-contact", "provider": "hubspot" },
    { "capability": "crm-create-task", "provider": "hubspot" },
    { "capability": "crm-associate-task-to-contact", "provider": "hubspot" }
  ],
  "started_at_iso": "<when stage 1 ran>"
}
```

Quote the file path back to the user. Print a one paragraph chat summary (or post to the Slack thread via slack_post_message if invoked from Slack):
`Found {firstname} {lastname} at {company}, {role}. Verified mobile: {phone or 'EU gap, email only'}. 12h task due {dueAtHuman}. Approve to push to HubSpot and Slack as draft?`

**9b. Hard approval prompt (verbatim):**

```
Push contact + 12h task to HubSpot and send the Slack DM? Type 'approve' to proceed, anything else to abort.
```

Block on the user response.

**9c. On `approve`, execute the chain. No silent retries. Stop on first failure.**

1. `crm-contact-upsert` (provider `hubspot`). Input shape:
   ```
   {
     contact: {
       email, firstname, lastname, company,
       phone, jobtitle: role, website
     }
   }
   ```
   Capture `contactId`. Do NOT send `linkedin_url` as a contact property -    it is not a standard HubSpot property and a portal without that custom
   field returns `PROPERTY_DOESNT_EXIST`. The contact's LinkedIn URL goes
   in the note body instead (step 2). The endpoint is `POST /crm/v3/objects/contacts?idProperty=email`:
   when the email already exists it returns **409 CONFLICT** with
   `"Existing ID: <id>"` in the message rather than upserting - parse that
   id and continue (this is a re-run, not a failure).

2. `crm-attach-note` (provider `hubspot`). Input shape:
   ```
   {
     contactId,
     body: "Signal: <role> opened at <company_domain> (<posted_at or 'date unknown'>). Source: <source_url>. Contact LinkedIn: <linkedin_url>",
     timestamp: <now ISO>
   }
   ```
   Capture `noteId`. The manifest sends only `hs_note_body` + `hs_timestamp`
   (the older `hs_note_contact_id` / empty `hubspot_owner_id` fields were
   removed - they returned `PROPERTY_DOESNT_EXIST` / invalid-owner). The
   note is linked to the contact by the separate association call in step 3.

3. `crm-associate-note-to-contact` (provider `hubspot`). Input shape:
   ```
   {
     noteId,
     contactId
   }
   ```
   The HubSpot note-create endpoint returns a `noteId` but does NOT link it to the contact timeline. This second call writes the `note_to_contact` association. If the association call fails or returns `associated: false`, the skill DOES NOT halt: the note exists, just isn't linked. It DMs the operator on Slack with the `noteId` + `contactId` so they can fix the link manually in HubSpot, then continues with the task creation.

4. `crm-create-task` (provider `hubspot`). Input shape:
   ```
   {
     subject: "Call <firstname> re: <role>",
     body: <opener>,
     dueAt: <stage 8 dueAtIso>
   }
   ```
   Capture `taskId`. The manifest sends only the `hs_task_*` properties
   (the older `hs_task_contact_id` / empty `hubspot_owner_id` were removed
   - `hs_task_contact_id` is not a real property). The task is linked to
   the contact by step 5.

5. `crm-associate-task-to-contact` (provider `hubspot`). Input shape:
   ```
   {
     taskId,
     contactId
   }
   ```
   Writes the `task_to_contact` association so the task appears under the
   contact and in the rep's queue scoped to that contact. Same non-halt
   policy as the note association (step 3): if it returns `associated:
   false`, DM the operator the `taskId` + `contactId` to link manually,
   then continue.

6. Send the Slack DM via `sendSlackNotification` (from `src/lib/services/slack.ts`). The function is gated on `slackConfig.notify_on`, so first call `setSlackConfig({ webhook_url: process.env.SLACK_WEBHOOK_URL, notify_on: ['signal_to_call_ready'] })`, then send. Payload:
   ```
   {
     event: "signal_to_call_ready",
     data: {
       leadName: "<firstname> <lastname>",
       campaignTitle: "<company> - <role>",
       campaignId: <contactId>,
       replyPreview: <opener>
     }
   }
   ```

**9d. Print the final summary (or post to the Slack thread via slack_post_message if invoked from Slack):**

- HubSpot contact URL: `https://app.hubspot.com/contacts/<portalId>/contact/<contactId>` (the portal id is not known at runtime; leave it as `{portalId}` in the printout and let the operator click through).
- Task id and `dueAtHuman`.
- Time-to-completion in seconds (now - `started_at_iso`).

The skill never auto-dials and never auto-sends.

## Phone availability fallback

FullEnrich returns a verified mobile for the vast majority of US contacts and a meaningful share of EU contacts. When the enrichment call returns no phone for the resolved contact, the skill gracefully degrades to email outreach. It surfaces:
- `phone: null`
- `phone_unavailable_reason: 'no_verified_mobile_returned'`
- An explicit line in the Slack DM: "No verified mobile returned for this contact. Email this contact instead."

The contact still gets upserted into HubSpot with the email and the same 12 hour task. The opener is reframed as an email opener at draft time.

## Known errors and stops

- `qualifier_off_icp` - the qualifier dry run marked the company off-ICP. Halt; user adjusts ICP.
- `persona_unresolved` - no framework segment claims the posted role. Halt; user updates `framework.yaml`.
- `no_contact_found` - Fiber returned 0 usable hits. Halt; user broadens the role pattern.
- `enrichment_failed` - both email and phone empty after FullEnrich. Halt; user retries or escalates.
- `opener_failed_validation` - opener still has dashes after one rewrite. Halt; user inspects the template.
- HubSpot 4xx/5xx - surface the response verbatim. Do not retry.

## What this skill does NOT do

- Does not fetch the job posting page (assumes URL parse is enough for `{company, role}`). For richer parsing, the user pre-parses and sends the JSON payload form.
- Does not auto-dial the phone.
- Does not auto-send the email.
- Does not retry on HubSpot errors.
- Does not fall back to other people providers. Fiber for search, FullEnrich for enrichment.
- Does not move the HubSpot task to `IN_PROGRESS` - it sits in `NOT_STARTED` until the operator works it.

## Output

A live HubSpot contact, note, and 12 hour cold-call task, plus a Slack DM to the operator, all created in under 60 seconds from a single prompt. Plus a local dryrun JSON at `~/.gtm-os/signal-to-call/dryrun-{timestamp}.json` for audit.

## Reference

- `references/executive-resolution.md` - how the persona is picked from the framework, how the Fiber query is built, the opener template, and the EU phone caveat.
- Fiber adapter: `configs/adapters/people-search-fiber.yaml`
- FullEnrich adapter: `src/lib/providers/adapters/people-enrich-fullenrich.ts`
- HubSpot manifests: `providers/manifests/crm-contact-upsert/hubspot.yaml`, `providers/manifests/crm-attach-note/hubspot.yaml`, `providers/manifests/crm-associate-note-to-contact/hubspot.yaml`, `providers/manifests/crm-create-task/hubspot.yaml`, `providers/manifests/crm-associate-task-to-contact/hubspot.yaml`
- Slack output: `src/lib/services/slack.ts`
- Outbound rules: `src/lib/outbound/rules.ts`

## Attribution

Open source under MIT as part of YALC. Built on the Fiber people-search MCP and the FullEnrich enrichment API.
