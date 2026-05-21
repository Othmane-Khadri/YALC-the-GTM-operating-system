# Changelog

## 1.2.0 — 2026-05-21

Second holistic QA pass against the real lemlist MCP. The 1.1.0 chain held end-to-end — approval gate, DRAFT enforcement, snake→camel mapping, `excludes` baseline, the documented `status: "running"` lie on create and the accurate `campaignStatus: "draft"` on step adds all reproduced cleanly. Five gaps surfaced and closed in this release.

### Gaps closed

- **Sender attachment is now visible at approval time, not after the push.** Stage 24 dryrun spec now includes a `post_push_manual_steps[]` array and the orchestrator must list it prominently in the chat summary above the approval prompt — not buried in the JSON. The MCP transport does not reliably expose `set_campaign_senders`, so this step stays manual in the lemlist UI; the dryrun makes that explicit before the user types `approve`.
- **Industry filter no longer silently leaks non-SaaS companies.** Stage 11a now mandates layering a `keywordInCompany` filter (`["B2B", "SaaS", "B2B software", "B2B platform"]` recommended seed) on top of the `currentCompanySubIndustry` filter whenever the user's ICP says "B2B SaaS" or "B2B software". The `Technology, Information and Internet` subindustry bucket includes marketplace and consumer-internet companies — the keyword layer is the only way to tighten over the API today.
- **Company-level dedup added.** Stage 11b now also dedupes by `current_exp_company_name` for VP+ personas, governed by a new `dedupe_by_company` knob (default ON for `seniority_tier: VP+`, OFF for `Manager` and `IC`). Dropped leads surface in the dryrun's `deduped_leads[]` array so the user can override before pushing.
- **Headcount-bucket mismatch promoted to a top-line warning.** Stage 24 dryrun now includes a `coverage_warnings[]` array that quantifies the segment of the ICP lost to registry bucketing (e.g., ICP requested `10-80`, registry forced `11-50`, lost `50-80` segment). The orchestrator must list it in the chat summary alongside `post_push_manual_steps[]`.
- **`gtm-action-thinker` now supports optional auto-apply.** Stage 23 accepts a `gtm_thinker_autoapply: true` flag on the skill input. When set, the orchestrator applies the strongest mechanical fix from the critique (typically dropping a saturated filter value, tightening a leaky keyword, or removing a duplicated angle) and surfaces the before→after diff in the dryrun's `gtm_thinker_auto_applied[]` array. Default remains `false` — the critique stays advisory unless the user opts in.

### Locked-in behaviors (do not change)

- Approval gate refuses everything except the literal `approve`. Spec defined `yes` / `go` / `confirm` / `ok` as refusals; only `approve` triggers the push chain.
- `excludes` baseline on `lemleads_search` kept the sandbox-size payload inside context budget.
- snake_case → camelCase field mapping at `add_lead_to_campaign` time produced full success rate on the QA batch.
- DRAFT state held across the whole chain; `set_campaign_state` was never called with `start`.
- Both known-bad MCP behaviors (`status: "running"` lie on create, accurate `campaignStatus: "draft"` on step adds) reproduced exactly as documented in 1.1.0 — spec language is correct, keep it verbatim.

### Verified live

- Sandbox campaign created against the real lemlist MCP on 2026-05-20.
- Final state: DRAFT (verified via `add_sequence_step` campaignStatus on 25b and 25c).
- 5 leads added, 5/5 with email (`email_coverage_percent: 100`), 0 failed, 0 retries needed.
- Zero enrichment credits spent. Sourcing cost: 5 credits.
- Orchestrator never called `set_campaign_state` with action `start`.
- `validate_campaign_readiness` returned `has_errors` on missing sender, as expected (gap 1 above).

## 1.1.0 — 2026-05-20

Runtime correctness pass. Original 1.0.0 was committed without any live testing and contained MCP tool references that don't exist on the real lemlist server. This release fixes 17 bugs across the orchestrator, the README, the standalone install path, and adds QA scaffolding. Verified end-to-end against the real lemlist MCP on 2026-05-19.

### Critical runtime fixes (1-6)
- Replaced fictional `create_campaign` MCP tool with the real chain: `get_lemleads_filters` → `lemleads_search` → `create_campaign_with_sequence` → `add_sequence_step` × 2 → `add_lead_to_campaign` × N → `validate_campaign_readiness`.
- Removed the fictional "paused flag" claim. Campaigns are created in DRAFT state by default; orchestrator MUST NOT call `set_campaign_state` with action `start`.
- Added `get_lemleads_filters` as a mandatory pre-search step (stage 11a) — registry must be discovered at runtime, not hardcoded.
- Corrected stage 12 enrichment posture: `lemleads_search` does not import leads. Enrichment flags on `add_lead_to_campaign` are opt-in and cost credits; default OFF.
- Stage 25d spells out the per-lead sequential loop with retry on 429/5xx, partial-failure logging to `failed_leads[]`, and the 20%-failure stop condition.
- Stages 25a-25f thread `campaignId` (cam_xxx) and `sequenceId` (seq_xxx) through the chain explicitly.

### Structural fixes (7-11)
- Added a substrate→orchestrator handoff contract table covering stages 1-23, specifying which fields each substrate skill must yield and the fallback heuristic when extraction fails.
- Frontmatter description now declares the 24-skill substrate + `.mcp.json` dependency, so Claude fails fast if either is missing.
- Standalone install README rewritten: Node.js 18+ prereq, separate copy-vs-merge instructions for `.mcp.json` (no silent overwrite of an existing config), restart-Claude-Code note for the env var.
- Canonical install path is the env-var + npx mcp-remote setup; OAuth via `claude mcp add` demoted to "Alternative" with a CI/headless caveat.
- Added `tests/` scaffolding: JSON Schema for the dryrun output, sandbox prompt, expected MCP call list, regression checklist.

### Live-test findings (12-17)
Surfaced during the 2026-05-19 QA run against the real lemlist MCP.

- `get_lemleads_filters` response is ~93K chars (3,091 lines) — cannot fit in an LLM context in a single tool result. Stage 11a instructs grepping the saved-to-file response for needed filterIds + their `values` arrays.
- `lemleads_search` returns ~24K chars per lead (>1MB at 50 leads). Stage 11b mandates an `excludes` baseline (drop `experiences`/`interests`/`languages`/`inferred_skills`/`lead_logo_url`/`company_description`/`techno_used_array`) and expects per-lead parsing from a saved file.
- `create_campaign_with_sequence` response's `campaign.status` field is unreliable: returns `"running"` even though the actual stored state is `draft`. Stage 25a warns NOT to trust it. The `add_sequence_step` responses DO return an accurate `campaignStatus: "draft"` — trust those.
- `lemleads_search` returns snake_case (`full_name`, `potential_email`, `lead_linkedin_url`, `current_exp_company_name`) but `add_lead_to_campaign` expects camelCase. Stage 25d includes an explicit field-mapping table with transforms (split `full_name` on first space; `seniority` → `persona_tier` map; null `potential_email` flagged in `leads_without_email[]`).
- Email coverage in real searches is 70-85%. Dryrun now computes `email_coverage_percent` and `leads_without_email[]`. Three remediation paths documented: skip / Yalc `fullenrich-*` and `enrich-with-signals` skills (recommended; routes through the fullenrich MCP) / lemlist's `findEmail` flag (paid, opt-in only).
- `set_campaign_state` with action `archive` returns HTTP 500 intermittently. Safety contract names this as a known unstable endpoint; no silent retries.

### Standalone install prerequisites added
- "At least one email sender connected in lemlist Settings → Senders" — without one, `validate_campaign_readiness` fails at stage 25e and the campaign cannot launch even after manual review.

### Verified live
- Campaign `cam_33rB5CDzA2iu4xyca` created against the real lemlist MCP on 2026-05-19.
- Final state: DRAFT (verified via `add_sequence_step` responses).
- 5 leads added, 4 with email, 1 without.
- Zero enrichment credits spent.
- The orchestrator never called `set_campaign_state` with action `start`.
