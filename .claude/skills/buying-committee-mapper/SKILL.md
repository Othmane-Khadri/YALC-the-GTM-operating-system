---
name: buying-committee-mapper
description: Use when the user says "map the buying committee at X", "find the committee for [company]", "buying committee for [company]", "who are the 5 stakeholders at [company]", "build a committee outreach for [company]", or any variant indicating they want a single company resolved into a five-role buying committee (Champion, Economic Buyer, Technical Buyer, User, Blocker) with enriched contacts, persona-tuned messages, a Notion committee map page, and a five-thread Lemlist DRAFT campaign. Fiber for per-role people-search, FullEnrich for batch enrichment, Lemlist persona-tier copywriting atoms for messages, Notion for the committee map. Hard approval gate. Never auto-sends.
version: 0.2.0
---

# Buying Committee Mapper

Turn ONE target company into the full five-role buying committee (Champion, Economic Buyer, Technical Buyer, User, Blocker), enriched, persona-tuned, mapped in Notion, and queued as a five-thread DRAFT campaign in Lemlist.

The operator names a company. The skill asks two clarifying questions (what is being sold, who the first contact is), then dynamically proposes the five committee slots in context, gets the operator's go-ahead on the proposed mapping, and chains the rest:

- Offer + first-contact prompts
- Optional Fiber lookup to enrich the first contact (when LinkedIn URL or email is provided)
- An LLM role-generation step that proposes the five slots in context of the offer, first contact, and (if loaded) the framework ICP
- Operator confirms the proposed committee
- Fiber `people-search` (one call per role, five total)
- FullEnrich `enrich_bulk` (one call, all five contacts)
- Lemlist persona-tier copywriting atoms (`copywriting-vp-sequence`, `copywriting-manager-sequence`, `copywriting-ic-sequence`) with senior-operator voice rules injected verbatim
- A Notion committee map page
- A Lemlist `create_campaign_with_sequence` + four `add_sequence_step` calls (DRAFT)

A hard approval gate fires before any Notion or Lemlist write. Nothing auto-sends.

## When This Skill Applies

- "map the buying committee at Acme"
- "find the committee for Acme Inc"
- "who are the 5 stakeholders at Acme"
- "build a committee outreach for Acme"
- "buying committee for Acme"

## When invoked from Slack

If the invocation prompt mentions a Slack channel and thread, treat THAT Slack thread as your output surface instead of the chat. Everything that would normally print to the chat (clarifying questions, the proposed committee, the dryrun summary, the approval prompt) goes to the thread instead.

- Every progress message goes to the Slack thread via the Slack MCP (registered as `slack`). Use the tool `slack_post_message` with the channel and, when a thread timestamp is present, the same `thread_ts` (or `slack_reply_to_thread` for thread replies) so updates land in the same thread. There is no native message-update tool, so post a new message rather than trying to edit an existing one.
- Every approval gate (the committee-confirmation question and the hard approval prompt) is posted to the Slack thread as a short, structured preview, then you wait for either a thumbs-up reaction OR a thread reply matching `approve | ship it | looks good | go | yes` FROM THE ORIGINAL REQUESTER ONLY (the user id named in the invocation prompt). Poll for the reply with `slack_get_thread_replies` and use `slack_add_reaction` to acknowledge receipt. Ignore approvals from anyone other than the original requester. No one else can approve on their behalf.
- The final result goes back to the thread with any artifact URLs (Notion committee map page, Lemlist DRAFT campaign).
- Credit FullEnrich explicitly and prominently. When you start the enrichment step, post a message naming it, e.g. "Running FullEnrich to find verified work emails and direct mobile numbers for all 5 stakeholders...". In the dryrun summary and the final result, lead with the FullEnrich outcome and the hit rate, e.g. "Enriched all 5 stakeholders with FullEnrich: 5 of 5 verified work emails, 4 of 5 direct mobiles." FullEnrich is the contact-data engine for this agent and should be named every time enrichment is mentioned, never described generically as "enrichment".

The step chain below is unchanged; only the output surface moves to the Slack thread when a channel and thread are present in the invocation prompt.

## Prerequisites

```
FIBER_API_KEY=
FULLENRICH_API_KEY=
LEMLIST_API_KEY=
NOTION_API_KEY=
NOTION_PARENT_PAGE_ID=        # parent for the committee map page
```

The Lemlist MCP must be connected (`create_campaign_with_sequence`, `add_sequence_step`). The FullEnrich MCP must expose `enrich_bulk` and `get_enrichment_results`. The Fiber `people-search` adapter is declared at `configs/adapters/people-search-fiber.yaml`.

## Hard safety contract (MANDATORY)

This skill writes to Lemlist and Notion. It must never auto-send. Safeguards:

1. **DRAFT state is the default.** Campaigns are created in DRAFT via `create_campaign_with_sequence`. The orchestrator MUST NOT call `set_campaign_state` with action `start` anywhere in the chain.
2. **Dryrun first.** Render the full plan to `~/.gtm-os/buying-committee-mapper/dryrun-{timestamp}.json`. Quote the path back to the operator.
3. **Hard approval prompt.** After the dryrun, ask verbatim:
   > Stage the 5-thread DRAFT campaign in Lemlist and post the committee page to Notion? Type 'approve' to proceed.
   Block on the response. Do not call any Lemlist or Notion write tool until the operator types `approve`.
4. **No silent retries.** On the first failure of any write call, surface the error and stop.
5. **No emojis. No em-dash or en-dash in any drafted message.** A dash-scan validator runs on every message before the dryrun is written.

## Step chain

### Step 1: Resolve the target company

Inputs:
- `company_name` (required, free text)
- `domain` (optional)
- `tenantId` (optional, defaults to `'default'`)

If `domain` is missing, derive a lowercase no-space guess (e.g. `Acme Inc` => `acme.com`) and surface it back to the operator for confirmation.

### Step 2: Ask for the offer

Ask the operator verbatim:

> What are you selling to this company? Describe the offer in one or two sentences, what problem it solves and who feels the pain.

Capture the free-text response as `offer.description`. Do not proceed until this is answered.

### Step 3: Ask for the first contact

Ask the operator verbatim:

> Who are you talking to first at {company_name}? Either the LinkedIn URL, the email, or the title and name of the entry point.

Capture the free-text response as `first_contact.raw`. Do not proceed until this is answered.

If the response is a LinkedIn URL or an email, call Fiber `people-search` via `buildFirstContactLookup` to enrich the contact:
- linkedin URL: query Fiber by `linkedinUrl`.
- email: query Fiber by `email`.

Populate `first_contact.resolved_title`, `first_contact.resolved_seniority`, `first_contact.resolved_name` from the top match. If the response is "title and name", parse the title directly into `resolved_title` and the name into `resolved_name`; no Fiber call needed.

### Step 4: Load the framework

Call `loadFramework(tenantId)` from `src/lib/framework/context.ts`. Capture the primary segment (`framework.segments[0]`) if present. The framework is passed to the role-generation prompt as ICP context (hints, not a fixed mapping).

### Step 5: Generate the five committee slots, in context

This is the **only new generative LLM step** the skill introduces. Build the prompt via `buildRoleGenerationPrompt({ offer, firstContact, companyName, framework })`. The prompt is documented in full in `references/role-prompts.md`.

The prompt instructs the LLM to propose title patterns SPECIFIC to this offer and this entry point. There is NO baked-in default title mapping. Run the prompt against the operator's configured LLM. Parse the JSON response via `parseGeneratedRoles(...)`.

Output shape:
```
{
  roles: [
    { slot, title_patterns[], seniority_tier, pain_emphasis },
    ...  (5 entries, one per slot)
  ]
}
```

Then show the proposed mapping back to the operator and ask verbatim:

> Does this committee look right? Type 'yes' to proceed, or describe what to change.

If the operator types `yes` (case-insensitive), proceed. If they describe a change, regenerate by re-running the prompt with the operator's edit appended, then ask again. Do not advance to Fiber search until the operator confirms.

If the framework loaded in step 4 had non-empty `targetRoles[]` or `keyDecisionMakers[]`, record `framework_override_applied: true` in the dryrun (the LLM is told to use these as hints).

### Step 6: Fiber people-search per role

For each of the five confirmed roles, call the Fiber `people-search` capability:
```
POST  https://mcp.fiber.ai/mcp/v2
body  {
  "tool": "peopleSearch_tool",
  "apiKey": "${FIBER_API_KEY}",
  "input": {
    "company": "<company_name>",
    "title":   "<title_patterns joined with OR>",
    "limit":   5
  }
}
```
Map the response via `configs/adapters/people-search-fiber.yaml`. Take the top match per role.

If the first contact (step 3) already maps to one of the slots, skip the Fiber call for that slot and use the resolved first contact directly.

If a role returns zero results, record `{ slot, contact: null, reason: "no_fiber_match" }` and continue. No fallback to other people providers, Fiber is the sole search provider for this skill.

### Step 7: Batch FullEnrich enrichment

Build a single `enrich_bulk` payload with all resolved contacts (`firstname`, `lastname`, `company_name`, `linkedin_url`). Submit it. Poll `get_enrichment_results` until status leaves `running`. Capture per contact:
- `email`
- `email_status`
- `phone`

When FullEnrich returns no phone for a contact, set `phone_missing: true` in that role's dryrun entry.

### Step 8: Per-role message generation, with senior-operator voice

For each enriched contact, route by `seniority_tier`:
- `VP+` => `.claude/skills/lemlist/copywriting-vp-sequence/SKILL.md`
- `Manager` => `.claude/skills/lemlist/copywriting-manager-sequence/SKILL.md`
- `IC` => `.claude/skills/lemlist/copywriting-ic-sequence/SKILL.md`

Pass the role's `pain_emphasis` into the copywriting atom so each persona gets a different pain frame (see `references/role-prompts.md`). Capture only the first email's `{ subject, body }`. Committee mapping outreach is one-touch per stakeholder, queued as five parallel threads (not a 3-step sequence per stakeholder).

**Voice rules (passed verbatim into every atom call):**

> Direct. Straight to the point. Lead with the value, not the introduction.
>
> Data first, KPI driven. Anchor each message in a number or a concrete fact (industry benchmark, deal-size impact, time saved, error rate, conversion lift).
>
> No fluff. No "I hope this finds you well", no "just reaching out", no "I came across your profile".
>
> Some context, but only enough to put the value in perspective and earn trust. One sentence of "I noticed X about your situation" is enough.
>
> Concrete. Use specific numbers, specific products, specific outcomes. Do not say "improve efficiency", say "cut your QBR prep from 4 hours to 30 minutes."
>
> Per-persona angle stays: Champion gives a user-pain story; EconomicBuyer gets ROI math with specific dollar impact; TechnicalBuyer gets integration and technical risk, concrete; User gets daily friction, concrete; Blocker gets procurement risk mitigation, concrete.
>
> One forward-looking question at the end. Not "let me know your thoughts."
>
> No em-dash, no en-dash, no buzzwords (synergy, leverage, ecosystem, cutting-edge, best-in-class).
>
> Do not start the body with the word "I".

The exact string the orchestrator MUST pass is exported as `VOICE_RULES` from `src/lib/committee/buying-committee-mapper.ts`. Include it as the `voice_rules` field in the call payload to each copywriting atom.

After all five messages exist:
- Run a dash-scan validator on each body. If any message contains an em-dash or en-dash, regenerate that single message once. If it still contains a dash on the retry, surface the failure and stop.
- Check each body starts with a non-"I" word and contains at least one numeric token. If a body fails either, regenerate that message once and re-check.

### Step 9: Build the Notion committee map page

Build a Notion children array. One H2 per role. Under each: title patterns, resolved contact (name + LinkedIn URL + email + phone status + email_status), seniority tier, pain emphasis, and the message preview (subject + first 200 chars of body).

Do NOT call `NotionService.createChildPage` yet, only build the payload and record it in the dryrun.

### Step 10: Write the dryrun JSON

Path: `~/.gtm-os/buying-committee-mapper/dryrun-{ISO-timestamp}.json`. Schema:

```json
{
  "target_company": { "name": "...", "domain": "..." },
  "offer": { "description": "..." },
  "first_contact": {
    "raw": "...",
    "resolved_name": "...",
    "resolved_title": "...",
    "resolved_seniority": "Manager"
  },
  "framework_override_applied": true,
  "roles": [
    {
      "slot": "Champion",
      "title_patterns": ["..."],
      "seniority_tier": "Manager",
      "pain_emphasis": "user-pain story",
      "routed_copywriting_skill": "copywriting-manager-sequence",
      "contact": {
        "first_name": "...",
        "last_name": "...",
        "title": "...",
        "linkedin_url": "...",
        "email": "...",
        "email_status": "verified",
        "phone": null,
        "phone_missing": true
      },
      "message": { "subject": "...", "body": "..." }
    }
  ],
  "notion_page_draft_url": "pending_approval",
  "lemlist_mcp_call_plan": [
    { "tool": "create_campaign_with_sequence", "payload_summary": "..." },
    { "tool": "add_sequence_step", "payload_summary": "..." }
  ],
  "post_approve_artifacts": {
    "lemlist_campaign_id": null,
    "notion_page_url": null
  }
}
```

Quote the file path back. Print a one-paragraph summary (or post to the Slack thread via slack_post_message if invoked from Slack):
> 5 stakeholders mapped at {company_name} and enriched with FullEnrich: {E} of 5 verified work emails, {P} of 5 direct mobiles. All messages dash-clean. Approve to push?

### Step 11: Hard approval gate

Ask verbatim:
> Stage the 5-thread DRAFT campaign in Lemlist and post the committee page to Notion? Type 'approve' to proceed.

Block. Only on exact string `approve` proceed to step 12.

### Step 12: Push (Lemlist DRAFT + Notion)

Ordered calls. Stop on the first failure.

**12a. Lemlist MCP `create_campaign_with_sequence`**
Payload:
```
{
  name:     "Buying Committee, {company_name}",
  subject:  roles[0].message.subject,
  body:     roles[0].message.body,
  timezone: "Europe/Paris"
}
```
Capture `campaignId`, `sequenceId`. Campaign stays in DRAFT.

**12b-e. Lemlist MCP `add_sequence_step`** (for slots 2 through 5)
For each remaining role index `i` (1..4):
```
{
  campaignId,
  sequenceId,
  type:          "email",
  delay:         i,
  delayType:     "within",
  subject:       roles[i].message.subject,
  message:       roles[i].message.body,
  userConfirmed: true
}
```
Each step carries its own subject (NOT a thread reply), the five stakeholders are independent threads.

**12f. Notion page**
Call `NotionService.createChildPage(NOTION_PARENT_PAGE_ID, "Buying Committee, {company_name}", children)`. Capture the returned page id.

**12g. Update artifacts**
Patch the dryrun JSON: set `post_approve_artifacts.lemlist_campaign_id` and `notion_page_url`. Print both URLs back (or post to the Slack thread via slack_post_message if invoked from Slack).

**The orchestrator NEVER calls `set_campaign_state(start)`.** Hard contract.

## Output

A Lemlist campaign in DRAFT with five parallel email threads (one per committee role), a Notion committee map page under the operator's parent page, and a dryrun JSON file at `~/.gtm-os/buying-committee-mapper/dryrun-{timestamp}.json`.

## Reference

- Dynamic role generation prompt + per-slot pain emphasis: `references/role-prompts.md`
- Voice rules constant: `VOICE_RULES` in `src/lib/committee/buying-committee-mapper.ts`
- Fiber wiring: `configs/adapters/people-search-fiber.yaml`
- Notion service: `src/lib/services/notion.ts`
- Lemlist copywriting atoms: `.claude/skills/lemlist/copywriting-{vp,manager,ic}-sequence/SKILL.md`
- Persona seniority routing: `.claude/skills/lemlist/persona-definer/SKILL.md`
