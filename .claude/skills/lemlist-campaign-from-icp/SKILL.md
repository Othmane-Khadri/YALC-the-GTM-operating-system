---
name: lemlist-campaign-from-icp
description: Use when the user says "create a lemlist campaign for X", "build a lemlist campaign from this ICP", "spin a lemlist campaign for Y", "ICP to lemlist", "natural language to lemlist campaign", "draft a lemlist campaign", "lemlist campaign for VPs/Managers/ICs at Z", or any variant indicating they want to turn a natural-language ICP description into a paused, ready-to-review lemlist campaign with sourced leads and a seniority-routed sequence. Orchestrates 24 lemlist atomic skills (ICP, persona, sourcing, copywriting, QA) and the lemlist MCP server (`get_lemleads_filters`, `lemleads_search`, `create_campaign_with_sequence`, `add_sequence_step`, `add_lead_to_campaign`, `validate_campaign_readiness`) into one end-to-end loop. Hard approval gate before the MCP push — never auto-sends. Depends on the 24 lemlist atomic skills under `.claude/skills/lemlist/` and the lemlist MCP server declared in `.mcp.json` — fails fast if either is missing.
version: 1.2.0
---

# Lemlist Campaign From ICP

Turn a natural-language ICP prompt into a paused live lemlist campaign — leads sourced from lemlist's People Database, agentically enriched, routed by seniority, sequenced, refined, scored against the 244K-campaign benchmark, and pushed into a real lemlist account in PAUSED state for human review.

The user types one prompt. The skill chains 24 lemlist atomic skills + the lemlist MCP server. Approval gates fire before the campaign is created in lemlist. Nothing auto-sends.

## When This Skill Applies

- "create a lemlist campaign for VPs of Sales at Series B SaaS hiring AEs in Europe"
- "build a lemlist campaign from this ICP: …"
- "spin a lemlist campaign for managers in HR Tech using paid LinkedIn jobs"
- "ICP to lemlist"
- "natural language to lemlist campaign"
- "draft a lemlist campaign for me"

## Prerequisites

```
LEMLIST_API_KEY=         # https://app.lemlist.com → Settings → Integrations
```

OAuth alternative (interactive use): `claude mcp add --transport http lemlist https://app.lemlist.com/mcp`.

The lemlist MCP must be connected. Verify with `/mcp` in Claude Code — you should see operations like `get_lemleads_filters`, `lemleads_search`, `create_campaign_with_sequence`, `add_sequence_step`, `add_lead_to_campaign`, `set_campaign_state`, `validate_campaign_readiness`, campaign stats, etc.

This skill depends on the 24 atomic lemlist skills bundled under `.claude/skills/lemlist/`. They were imported from [lemlist's open-source skill library](https://github.com/l3mpire/claude-skills) under MIT. See `.claude/skills/lemlist/README.md` for the attribution and update procedure.

## Hard safety contract (MANDATORY)

This skill creates a campaign in a real lemlist account using paid lemlist credits (sourcing + agentic enrichment). It must never auto-send. Safeguards:

1. **DRAFT state is the default.** Campaigns are created in DRAFT state by default via `create_campaign_with_sequence`. The orchestrator MUST NOT call `set_campaign_state` with action `start`. Verify with `validate_campaign_readiness` before reporting readiness to the user. The campaign stays in DRAFT in the user's lemlist account until the user starts it manually in the lemlist UI.
2. **Dryrun first.** Render the full sequence text, the lead list summary, the persona routing breakdown, and the estimated lemlist credit usage to a local JSON file at `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`. Quote the file path back to the user.
3. **Lead count ceiling.** Default cap is 50 leads per run. The user can raise it with an explicit instruction, but the skill always quotes the number back before sourcing.
4. **Hard approval prompt.** After the dryrun, the skill asks `"Approve creating campaign '{title}' in lemlist with {N} leads and the sequence above? Type 'approve' to push, anything else to abort."` Block on the user response. Do not call any campaign-creation or lead-add MCP tool until the user types `approve`.
5. **No silent retries.** If any MCP creation/add call fails, surface the error and stop. Do not retry without explicit user instruction. Known unstable endpoint (verified live, 2026-05-19): `set_campaign_state` action `archive` can return HTTP 500 intermittently — never retry blindly; surface the error and let the user clean up via the lemlist UI.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS produce the dryrun output first.
2. Quote the EXACT lead count and the EXACT campaign title back to the user.
3. WAIT for explicit user `approve` before calling any campaign-creation or lead-add MCP tool.
4. Only proceed past dryrun after the user has approved the spend in this conversation.

## Stage handoff contract (what to extract and carry forward)

Each substrate skill returns prose. Claude must extract the listed fields at each stage and persist them in a working memory object that the orchestrator threads forward. If a field cannot be extracted, apply the fallback. Never proceed past stage 17 with empty `emails[]`.

| Stage | Substrate skill | Field(s) to extract | Fallback if missing |
|---|---|---|---|
| 1 | `icp-definer` | `industries[]`, `geo[]`, `size_range_employees[]`, `active_signals[]` | Ask user to confirm before stage 2 |
| 2 | `persona-definer` | `personas[].title_patterns[]`, `personas[].seniority_tier` (must be `VP+` / `Manager` / `IC`), `personas[].pains_identified[]` | If `seniority_tier` ambiguous, map titles: `VP*/SVP*/Chief*` → VP+; `Manager*/Head of*/Director*` → Manager; else IC. |
| 3 | `pain-identifier` | `pains[]` (text) | Continue without; mark as `pains: []` in dryrun |
| 4 | `value-prop-lister` | `value_props[]` | Ask user once |
| 5 | `offer-definer` | `offer` (text) | Derive from `value_props[0]` |
| 6 | `competitor-finder` | `competitors[].{name, differentiation}` | Skip; mark `competitors: []` |
| 7 | `trigger-finder` | `triggers[]` | Skip; mark `triggers: []` |
| 8 | `company-finder` | `firmographic_filters[]` (as filterId+in/out triplets) | Map from ICP fields with the active filter registry from stage 11a |
| 9 | `list-builder` | `combined_filters[]` | Equal to `firmographic_filters` if no extra signals |
| 10 | `people-finder` | `persona_filters[]` (currentTitle, seniority) | Derive from `persona.title_patterns` |
| 13 | `linkedin-outbound-angle` | `lead.angle` (text, per-lead) | Default to generic offer-led angle |
| 14 | `campaign-angle-finder` | `chosen_angle` | Pick first if user does not respond |
| 15 | `outbound-campaign-architect` | `sequence_shape: { steps: [{delay_days, channel}] }` | Default: 3 emails, delays [0, 3, 6] |
| 17 | `copywriting-{vp,manager,ic}-sequence` | `emails[].{subject, body}` (length 3) | Block; do not proceed without |
| 18 | `copywriting-first-touch` | `emails[0]` rewrite | Keep original if no rewrite |
| 19 | `copywriting-follow-up` | `emails[1..2]` rewrites | Keep originals |
| 20 | `cta-designer` | `emails[].cta` overrides | Keep originals |
| 21 | `copywriting-refiner` | `emails[].refined` | Keep originals |
| 22 | `copywriting-analyzer` | `score` (0-100), `improvement_notes[]` | Mark `score: null`; surface to user |
| 23 | `gtm-action-thinker` | `weakest_assumption` (text) | Skip |

## End-to-end orchestration (25 stages)

The skill walks Claude Code through the following chain. Each stage names the lemlist atomic skill or MCP operation it invokes.

### Stage 1 — Strategic foundation (7 skills)

For each step below, invoke the lemlist atomic skill at `.claude/skills/lemlist/{skill-name}/SKILL.md`. Capture the structured output and feed it forward.

1. `icp-definer` — turn the user's natural-language prompt into a structured ICP (firmographics, geography, signal triggers).
2. `persona-definer` — derive specific buyer personas from the ICP. Each persona carries a seniority tier (VP+ / Manager / IC).
3. `pain-identifier` — for each persona, identify evidence-based pain points based on growth signals, tech stack, hiring activity.
4. `value-prop-lister` — extract value props from the user's product context (if shared) or ask the user to confirm 2–3 anchor value props.
5. `offer-definer` — transform value props into outcome-focused offers, one per persona.
6. `competitor-finder` — identify 2–3 obvious competitors per persona; generate differentiation angles to weave into the copy.
7. `trigger-finder` — identify buying triggers (funding rounds, exec hires, tool changes) that the messaging can reference.

### Stage 2 — Sourcing (3 skills + 2 MCP ops)

Lemlist's filter registry can change. Always discover filterIds at runtime rather than hardcoding.

8. `company-finder` — translate the ICP into a lemlist firmographic search configuration (industry, size, geography, technographics).
9. `list-builder` — combine the firmographic config with signal filters (e.g., active hiring, funding signals) into a single search shape.
10. `people-finder` — translate persona seniority + role into lemlist People Database search filters.
11a. **MCP call: `get_lemleads_filters`** — fetch the active filter registry.

    **Payload size warning (verified live, 2026-05-19):** the response is ~93K chars / 3,091 lines and cannot fit in an LLM context window in a single tool result. When the MCP returns "result exceeds maximum allowed tokens, output saved to <path>", grep that file for the specific filterIds you need (`currentTitle`, `seniority`, `country`, `region`, `currentCompanyHeadcount`, `department`, `currentCompanySubIndustry`, etc.) plus their `values` arrays. Do NOT attempt to load the full registry into chat.

    Use the returned `filterId` values to shape the search filters array. UI-only filters (`notInContacts`, `notInCampaign`) are not available over this transport — drop them if surfaced by upstream skills.

    **Industry-filter leak warning (verified live, 2026-05-20):** `currentCompanySubIndustry` has no clean "B2B SaaS" bucket. The two closest values are `Software Development` and `Technology, Information and Internet`, but the latter contains marketplace and consumer-internet companies. When the user's ICP says "B2B SaaS" (or "B2B software"), the orchestrator MUST layer a `keywordInCompany` filter on top of the subindustry filter — recommended seed terms: `["B2B", "SaaS", "B2B software", "B2B platform"]`. Without this layer, non-SaaS leads will leak through and waste sourcing credits.

11b. **MCP call: `lemleads_search`** with `mode: "people"` (or `"companies"`, never `"leads"`) and a `filters` array of `{filterId, in, out}` objects derived from stage 11a. Cap `size` at the lead count ceiling (default 50, max 100 per page). Dedupe results by `linkedin_url` and `email` before storing in working memory.

    **Company-level dedup (verified live, 2026-05-20):** for VP+ persona targeting where the buyer is the only decision-maker per company, also dedupe by `current_exp_company_name`. This is governed by the `dedupe_by_company` knob, defaulted ON for `seniority_tier: VP+` and OFF for `Manager` and `IC` tiers (where multiple champions per company are useful). When the knob drops a lead, surface the dropped lead in the dryrun's `deduped_leads[]` array with the kept lead's id so the user can override.

    **Payload size warning (verified live, 2026-05-19):** each lead returns ~24K chars; a 5-lead call already exceeds 122K chars, a 50-lead call would exceed 1MB. Two mitigations the orchestrator MUST apply:
    1. **Pass `excludes`** to drop heavyweight nested objects you don't need at this stage (recommended baseline: `excludes: ["experiences", "interests", "languages", "inferred_skills", "lead_logo_url", "company_description", "techno_used_array"]`).
    2. **Expect the response to be saved to a file** by the MCP host when over the context limit. Grep/parse that file with a small script to extract only the per-lead fields needed for stage 12 forward: `full_name`, `potential_email`, `lead_linkedin_url`, `current_exp_company_name`, `country`, `headline`, `seniority`, `department`. Do NOT attempt to load the full response into chat.

### Stage 3 — Enrichment posture

12. `lemleads_search` returns search results, not imported leads. Search results include a `potential_email` field for most (but not all) leads. The orchestrator does NOT toggle the per-call enrichment flags (`findEmail`, `verifyEmail`, `linkedinEnrichment`, `findPhone`) on `add_lead_to_campaign` by default — those cost credits per flag per lead.

    **Lead email coverage (verified live):** in real searches, 70-85% of leads ship with a `potential_email`; the rest have `null` or missing. The orchestrator must compute and surface an `email_coverage_percent` figure in the dryrun (stage 24) so the user can decide what to do with the gap.

    **Three paths to fill the gap, in order of preference:**
    1. **Skip leads without email.** Cheapest; reduces effective list size.
    2. **Use a Yalc enrichment skill** (`fullenrich-plg-reverse-lookup`, `fullenrich-content-engagers`, `fullenrich-network-activation`, `fullenrich-event-attendees`, or `enrich-with-signals`) — these run through the fullenrich MCP server and resolve emails from LinkedIn URL + name + company. Recommended path: enrich the missing-email subset via the appropriate fullenrich skill BEFORE stage 25d, then re-merge.
    3. **Toggle lemlist's `findEmail: true`** on `add_lead_to_campaign` — fastest but per-lead-per-flag credit cost. Only use when the user explicitly opts in via an instruction like "enrich emails through lemlist" before approval. Quote the projected credit cost back to the user during the dryrun.

### Stage 4 — Per-lead personalization angle

13. `linkedin-outbound-angle` — for each lead, analyze the enriched LinkedIn profile and pick the strongest personalization angle. Store per-lead.

### Stage 5 — Campaign design (2 skills)

14. `campaign-angle-finder` — generate 3 distinct campaign angles for the target persona using the ICP, pains, offer, and triggers. Pick the top angle (or surface the 3 to the user for a one-line decision).
15. `outbound-campaign-architect` — design the high-level sequence structure (number of touches, channel mix, timing) using lemlist's benchmark data (244K campaigns, 249M emails).

### Stage 6 — Routing + writing (5 skills, conditional)

16. **Route by seniority** based on `persona-definer` output:
    - VP+ → `copywriting-vp-sequence`
    - Manager → `copywriting-manager-sequence`
    - IC → `copywriting-ic-sequence`
17. Invoke the routed skill with the enriched lead, the offer, the angle, and the trigger context. Output: a 3-email sequence per persona tier.
18. `copywriting-first-touch` — tighten the opener of each sequence using the per-lead angle from stage 13.
19. `copywriting-follow-up` — write the follow-up email(s) with fresh angles, citing the pain points from stage 3 and the triggers from stage 7.
20. `cta-designer` — design reply-worthy CTAs per email. Replace generic asks with value-based prompts.

### Stage 7 — Quality gate (3 skills)

21. `copywriting-refiner` — audit the full sequence against the quality checklist. Rewrite any failing elements.
22. `copywriting-analyzer` — score the final copy against lemlist's 244K-campaign benchmark. Surface the score and the top 2 improvement notes to the user.
23. `gtm-action-thinker` — final challenge pass: "what's the weakest assumption in this campaign? what would break the reply rate?" Surface the answer; rewrite if the user agrees.

    **Optional auto-apply (verified live, 2026-05-20):** the skill input accepts a `gtm_thinker_autoapply: true` flag. When set, the orchestrator inspects the critique and applies the strongest mechanical fix automatically — typically dropping a saturated filter value (e.g. `currentCompanyLastFundingRoundAt: "Less than 1 month"` is inbound-saturated and reduces reply rate), tightening a leaky keyword, or removing a duplicated angle from the sequence. Surface the applied change in the dryrun's `gtm_thinker_auto_applied[]` array (with the original vs. new payload diff). Default is `false` — the critique stays advisory unless the user opts in.

### Stage 8 — Approval gate

24. **Render the full dryrun** to `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`:
    - `campaign_title` (proposed, user can override)
    - `icp` (structured)
    - `personas[].title_patterns[]`
    - `personas[].seniority_tier` — must be one of `"VP+"`, `"Manager"`, `"IC"`
    - `personas[].routed_sequence_skill` — one of `copywriting-vp-sequence` / `copywriting-manager-sequence` / `copywriting-ic-sequence`
    - `proposed_filters[]` — array of `{filterId, in, out}` objects (real filterIds from stage 11a)
    - `leads[]` — each with `linkedin_url`, `email`, `email_status`, `enrichment_planned: bool`, `angle` (per-lead text from stage 13), `persona_tier`
    - `sequence_steps[]` — 3 emails with `delay_days`, `subject`, `body` per step
    - `copywriting_analyzer_score` (0-100, may be `null` if stage 22 failed)
    - `email_coverage_percent` — (count of leads with `potential_email`) / total × 100, rounded to nearest int
    - `leads_without_email[]` — list of `{full_name, linkedin_url, company}` for leads missing `potential_email`
    - `enrichment_plan` — `"skip" | "fullenrich" | "lemlist_findEmail"`; default `"skip"` unless user opts in
    - `estimated_lemlist_credits` — `{sourcing, enrichment}` breakdown (enrichment cost is zero unless `enrichment_plan = "lemlist_findEmail"`)
    - `mcp_call_plan[]` — ordered list of the exact MCP calls + payloads that will fire on approval (campaignId and sequenceId shown as placeholders; real IDs only known after stage 25a fires)
    - `coverage_warnings[]` — top-line array of ICP→registry-bucket mismatches the user must see before approving. Promoted from buried `filter_caveats[]` so the user knows which slices of the ICP got lost. Each entry: `{axis, requested, registry_bucket_used, lost_segment, est_impact}`. Example: `{axis: "headcount", requested: "10-80", registry_bucket_used: "11-50", lost_segment: "50-80 (companies in this range will not be sourced)", est_impact: "~25% of TAM excluded"}`.
    - `deduped_leads[]` — leads dropped by the `dedupe_by_company` knob (stage 11b). Each entry: `{dropped_lead_id, dropped_full_name, kept_lead_id, reason}`. Empty array if knob is off or no duplicates found.
    - `gtm_thinker_auto_applied[]` — populated when `gtm_thinker_autoapply: true`. Each entry: `{change_type, before, after, rationale_from_thinker}`. Empty array if knob is off.
    - `post_push_manual_steps[]` — required user actions in the lemlist UI AFTER the MCP push completes but BEFORE the campaign can launch. The MCP transport does not reliably expose every campaign-config endpoint, so some setup must happen in the UI. Standard entries: `["attach a sender (Settings → Senders on the campaign page) — without one, validate_campaign_readiness fails with 'No senders configured on this campaign'"]`. Surface this array prominently in the chat summary, NOT buried in the JSON.

    Quote the file path back to the user. Print a one-paragraph summary in chat: `N leads sourced, M personas, X-touch sequence, score Y/100. Approve to push as draft campaign '{title}'?` Below the summary, list `post_push_manual_steps[]` and `coverage_warnings[]` verbatim so the user sees both before typing `approve`.

### Stage 9 — Push (real MCP chain)

25. **On `approve`**, execute the following ordered MCP calls. Capture returned IDs and thread them forward. Stop immediately on the first failure.

    **25a. MCP call: `create_campaign_with_sequence`**
    Payload: `{ name: <campaign_title>, subject: <sequence_steps[0].subject>, body: <sequence_steps[0].body>, emoji: <optional>, timezone: <user-supplied or "Europe/Paris"> }`
    Capture: `campaignId` (cam_xxx), `sequenceId` (seq_xxx)
    Result: campaign created in DRAFT state with step 1 in place.

    **Response field warning (verified live, 2026-05-19):** the response includes a `campaign.status` field that may return `"running"` even though the campaign is actually stored as `draft`. DO NOT trust the status field from the create response. The actual stored state is `draft` by default. To verify, you can call `set_campaign_state` with `action: "pause"` — if the response is `{"success": false, "previousStatus": "draft", ...}`, that confirms the campaign is already in draft. The `add_sequence_step` responses (stages 25b/c below) DO include an accurate `campaignStatus: "draft"` field — trust those instead.

    **25b. MCP call: `add_sequence_step`** (for step 2)
    Payload: `{ campaignId, sequenceId, type: "email", delay: <sequence_steps[1].delay_days>, delayType: "within", message: <sequence_steps[1].body>, subject: <omit to send as thread reply>, userConfirmed: true }`

    **25c. MCP call: `add_sequence_step`** (for step 3)
    Payload: `{ campaignId, sequenceId, type: "email", delay: <sequence_steps[2].delay_days>, delayType: "within", message: <sequence_steps[2].body>, subject: <omit to send as thread reply>, userConfirmed: true }`

    **25d. For each lead in `leads[]`: MCP call: `add_lead_to_campaign`**
    Payload: `{ campaignId, email, firstName, lastName, linkedinUrl, companyName, customVariables: { angle, persona_tier, headline, country }, deduplicate: true }`. Enrichment flags (`findEmail`, `verifyEmail`, `linkedinEnrichment`, `findPhone`) are OFF by default — see stage 12 enrichment posture.

    **Field naming translation (verified live, 2026-05-19):** `lemleads_search` returns snake_case fields; `add_lead_to_campaign` expects camelCase. Map them explicitly:

    | From `lemleads_search` result (snake_case) | To `add_lead_to_campaign` (camelCase) | Transform |
    |---|---|---|
    | `full_name` | `firstName` + `lastName` | Split on first space; if no space, `firstName = full_name` and omit `lastName` |
    | `potential_email` | `email` | May be `null` or missing for ~15-30% of leads — see stage 12 |
    | `lead_linkedin_url` | `linkedinUrl` | URL-encoded special chars (e.g. `é`) round-trip OK |
    | `current_exp_company_name` | `companyName` | If contains `®`, `™`, etc., consider stripping (lemlist tolerates but UI display can be ugly) |
    | `headline` | `customVariables.headline` | Useful Liquid variable for personalization |
    | `country` | `customVariables.country` | Same |
    | `seniority` | `customVariables.persona_tier` | Map: `"Executive Leadership"` → `"VP+"`, `"Department Leadership"` → `"VP+"`, `"People Management / Leadership"` → `"Manager"`, else `"IC"` |

    Leads with missing `potential_email`: still call `add_lead_to_campaign` (the API requires at least one field, not specifically email) but flag them in the dryrun `leads_without_email[]` array. Email steps will silently skip for those leads at send time.

    Rate-limit and partial-failure handling:
    - Process leads sequentially, not in parallel (lemlist API is rate-limited).
    - On 429 or 5xx, retry once with 2s backoff; on second failure, log the lead to the dryrun JSON's `failed_leads[]` array and continue.
    - After the loop, surface `succeeded_count`, `failed_count`, and the `failed_leads[]` summary to the user before stage 25e.
    - If `failed_count > 0.2 * succeeded_count`, STOP and surface the failure summary; do not validate readiness.

    **25e. MCP call: `validate_campaign_readiness`**
    Payload: `{ campaignId }`
    Surface the result (`ready` or `has_errors` + the `errors[]` array) to the user verbatim.

    **25f. Print the campaign URL** so the user can review in the lemlist UI before starting:
    `https://app.lemlist.com/campaigns/{campaignId}` (verify URL format against lemlist docs at publish time).

    The orchestrator NEVER calls `set_campaign_state` with action `start`. The campaign stays in DRAFT until the user starts it manually.

## Post-launch (companion, not in this skill)

- `outbound-analyst` — once the campaign has run for a week, benchmark its stats against lemlist's 244K-campaign data.
- `reply-handler` — on every reply event from the lemlist MCP, draft a categorized response. Surface in Notion for human review.

These run from a separate orchestration skill (forthcoming) so that `lemlist-campaign-from-icp` stays focused on the one-prompt-to-paused-campaign flow.

## What This Skill Does NOT Do

- Does not write the product context for you. If the user hasn't shared what they sell, ask once before stage 4.
- Does not push CRM updates. lemlist owns the campaign state.
- Does not auto-start the campaign. PAUSED is hard-coded.
- Does not retry on MCP errors. Surface and stop.
- Does not handle replies. See `reply-handler` companion (above).
- Does not source from outside lemlist's People Database in this version. Other sourcing adapters (Crustdata, PredictLeads) can swap in at stage 11 — out of scope for the showcase loop.

## Output

A paused campaign live in the user's lemlist account, with:
- Sourced + enriched leads from lemlist People Database
- Seniority-routed sequence (3 emails per persona tier)
- Personalized angles per lead
- Refined copy scored against lemlist's benchmark
- Title proposed by the skill (user can override in lemlist UI)

Plus a local dryrun JSON file at `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json` for audit.

## Reference

- 24 lemlist atomic skills: `.claude/skills/lemlist/` (each has its own `SKILL.md`)
- Lemlist MCP server: `https://app.lemlist.com/mcp` (declared in repo-root `.mcp.json`)
- Lemlist People Database + Agentic Enrichment docs: <https://www.lemlist.com/claude-skills>
- Affiliate signup if needed: <https://get.lemlist.com/skrtwnkxw60i>
- Landing page: <https://yalc.ai/skills/lemlist-campaign-from-icp/>

## Attribution

Built in partnership with lemlist. Lemlist atomic skills under MIT (lemlist's [claude-skills repo](https://github.com/l3mpire/claude-skills) README). Orchestration logic open-source under MIT as part of YALC.
