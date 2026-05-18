---
name: lemlist-campaign-from-icp
description: Use when the user says "create a lemlist campaign for X", "build a lemlist campaign from this ICP", "spin a lemlist campaign for Y", "ICP to lemlist", "natural language to lemlist campaign", "draft a lemlist campaign", "lemlist campaign for VPs/Managers/ICs at Z", or any variant indicating they want to turn a natural-language ICP description into a paused, ready-to-review lemlist campaign with sourced leads and a seniority-routed sequence. Orchestrates 24 lemlist atomic skills (ICP, persona, sourcing, copywriting, QA) and the lemlist MCP server (`lemleads_search`, `create_campaign`) into one end-to-end loop. Hard approval gate before the MCP push — never auto-sends.
version: 1.0.0
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

The lemlist MCP must be connected. Verify with `/mcp` in Claude Code — you should see operations like `create_campaign`, `lemleads_search`, campaign stats, etc.

This skill depends on the 24 atomic lemlist skills bundled under `.claude/skills/lemlist/`. They were imported from [lemlist's open-source skill library](https://github.com/l3mpire/claude-skills) under MIT. See `.claude/skills/lemlist/README.md` for the attribution and update procedure.

## Hard safety contract (MANDATORY)

This skill creates a campaign in a real lemlist account using paid lemlist credits (sourcing + agentic enrichment). It must never auto-send. Safeguards:

1. **PAUSED state is the default.** The MCP `create_campaign` call always passes the paused flag. The user must manually start the campaign from the lemlist UI.
2. **Dryrun first.** Render the full sequence text, the lead list summary, the persona routing breakdown, and the estimated lemlist credit usage to a local JSON file at `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`. Quote the file path back to the user.
3. **Lead count ceiling.** Default cap is 50 leads per run. The user can raise it with an explicit instruction, but the skill always quotes the number back before sourcing.
4. **Hard approval prompt.** After the dryrun, the skill asks `"Approve creating campaign '{title}' in lemlist with {N} leads and the sequence above? Type 'approve' to push, anything else to abort."` Block on the user response. Do not call MCP `create_campaign` until the user types `approve`.
5. **No silent retries.** If `create_campaign` fails, surface the error and stop. Do not retry without explicit user instruction.

**When Claude invokes this skill on a user's behalf:**
1. ALWAYS produce the dryrun output first.
2. Quote the EXACT lead count and the EXACT campaign title back to the user.
3. WAIT for explicit user `approve` before calling MCP `create_campaign`.
4. Only proceed past dryrun after the user has approved the spend in this conversation.

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

### Stage 2 — Sourcing (3 skills + 1 MCP op)

8. `company-finder` — translate the ICP into a lemlist firmographic search configuration (industry, size, geography, technographics).
9. `list-builder` — combine the firmographic config with signal filters (e.g., active hiring, funding signals) into a single search shape.
10. `people-finder` — translate persona seniority + role into lemlist People Database search filters.
11. **MCP call: `lemleads_search`** with the combined search shape — returns a live lead list from lemlist's People Database. Cap at the lead count ceiling (default 50). Dedupe by `linkedin_url` and `email`.

### Stage 3 — Enrichment

12. **MCP-side: lemlist Agentic Enrichment** runs automatically on every lead imported via `lemleads_search`. AI agents research the lead's website, LinkedIn profile, recent news, hiring activity, and tech stack. No skill invocation needed — the enrichment is part of lemlist's platform.

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

### Stage 8 — Approval gate

24. **Render the full dryrun** to `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`:
    - `icp` (structured)
    - `personas` (with seniority routing)
    - `leads` (sourced + enriched, capped at the ceiling)
    - `angles` (per lead)
    - `sequence` (per persona tier, all emails inline)
    - `copywriting_analyzer_score`
    - `estimated_lemlist_credits` (sourcing + enrichment)
    - `campaign_title` (proposed, user can override)

    Quote the file path back to the user. Print a one-paragraph summary in chat: `N leads sourced, M personas, X-touch sequence, score Y/100. Approve to push as paused campaign '{title}'?`

### Stage 9 — Push

25. **On `approve`: MCP call `create_campaign`** with the sequence, the lead list, PAUSED state, and the proposed title. Surface the campaign URL in lemlist back to the user. Do not start the campaign — the user does that from the lemlist UI after final review.

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
