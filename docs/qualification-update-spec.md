# YALC Qualification Update — Build Spec

**Status:** Ready to execute
**Repo:** `yalc-internal` (also OSS upstream `Othmane-Khadri/YALC-the-GTM-operating-system` — see deployment note at bottom)
**Owner:** Whoever runs Claude Code in the yalc-internal repo with this spec
**Author of context:** Earleads CTO audit, May 2026
**Reference:** Notion page "Qualification Update" (Earleads workspace)

---

## Mission

Tighten yalc's qualification pipeline so it stops admitting off-ICP leads. Current real-world false positive rate on a recently-shipped campaign was **48%** (45 of 93 supposedly-qualified leads turned out to be wrong on closer inspection). This is a real bug in the pipeline, not a configuration issue. Fix the pipeline.

The fix is fully **additive**: every change in this spec must preserve current behavior for any team member who's already cloned yalc and is running campaigns. New behavior is opt-in via flags, schema fields, or per-campaign config.

---

## Why this exists

The current 7-gate pipeline produces a high false positive rate because:
1. It loads only generic ICP from `gtm-os.yaml`, never per-client context.
2. It trusts source data (CSV / Sales Nav / scraper output) as truth — no real-time verification against LinkedIn experience.
3. The deterministic gates (1-4) run regex against text files, but the YAML's structured ICP (`target_industries`, `disqualifiers`) never becomes deterministic rules — they only sit as text in the AI prompt.
4. The AI gate is therefore the only ICP filter, and it's subjective.

The fix in this spec addresses each of those four root causes directly. See "Audit findings" and the new pipeline below.

The numbers and named examples in **Appendix A** are proof that this matters — a recently-shipped real campaign had a 48% false positive rate (45 of 93 leads), with the largest single failure mode being 16 leads from outside the client's stated ICP (insurance brokers in a payroll-tech campaign). They're test-fixture material, not the rationale.

---

## Current pipeline (the "before")

Driven by `src/lib/qualification/pipeline.ts:runQualify()`, triggered by `leads:qualify` CLI command.

```
1. Dedup                       — by provider_id / linkedin_url
2. Headline regex              — config.qualification.rules_path
3. Exclusion regex             — config.qualification.exclusion_path
4. Company disqualifier regex  — config.qualification.disqualifiers_path
5. Optional Unipile enrichment — only if company/industry missing.
                                  Pulls headline, company, industry.
                                  DOES NOT request linkedin_sections=experience.
6. AI qualification (Claude)   — semantic scoring against framework context built
                                  from gtm-os.yaml. Prompt has no explicit rule
                                  about disqualified industries.
7. Score ≥ 50                  → keep
```

---

## Audit findings — five gaps to close

1. **No experience-section verification.** `src/lib/services/unipile.ts:getProfile()` already accepts an optional `sections` parameter (added at some point but never wired up). The pipeline never passes it. Result: yalc cannot detect stale employers or title drift.

2. **No stale-employer / "ex-X" detection.** Headlines like "ex-Google Cloud & UKG" pass through unflagged. No tenure check on current role. No way to see "person changed jobs in last 30 days."

3. **Gate ordering bug.** Gate 4 (company disqualifier) runs *before* Gate 5 (enrichment). If enrichment corrects the company, the disqualifier check never re-runs against the corrected data. So if source data says "Acme Corp" (clean) and enrichment reveals "Globex EOR" (would be disqualified), nothing catches it.

4. **YAML ICP isn't bridged to deterministic rules.** `gtm-os.yaml` has `target_industries`, `disqualifiers`, etc. per segment. These get injected as text into the Claude prompt at Gate 6. They never become automated regex/exact-match rules in Gates 1-4. Subjective scoring instead of deterministic filtering.

5. **No per-client ICP loading.** `gtm-os.yaml` is a single generic file. Every team member runs every client's campaign through the same YAML. There is no mechanism to load datascalehr's specific ICP (which lives in their `clients/datascalehr.yml` in the Earleads repo and on a Notion "ICP & Qualification" page) into yalc at qualification time. **This is the root cause** of the C8 failure.

---

## Locked scope for v1

Four changes. All four ship in this PR. Nothing more.

| # | Change | Type |
|---|---|---|
| 1 | **Per-client ICP loader at plan time** | New capability, additive |
| 2 | **Mandatory enrichment with `linkedin_sections=experience`** | Behavior change (gated by flag, opt-in) |
| 3 | **Drift check (informational)** | New gate, additive — flags, doesn't reject |
| 4 | **Verified-employer ICP match (deterministic)** | New gate, additive — only fires when client ICP is loaded |

**Explicitly OUT of v1 scope** (separate PRs later):
- Location filter as a standalone gate (folds into change #4 once `target_geographies` exists in the per-client ICP schema — define the field now, enforce later).
- Score threshold raise (stays at 50 globally; per-campaign override is fine but not required).
- Manual review queue UI (opt-in flag and table output is acceptable; a dedicated review surface is a later PR).
- HeyReach push integration.
- ICP staleness sync mechanism (v1 fetches Notion fresh every run; cache layer comes later).

---

## Backward-compat constraints (HARD)

1. **Existing `leads:qualify` runs without any new flags must behave exactly as today.** No flag-less behavior change. Anyone who's cloned yalc and runs the CLI as before gets the exact same pipeline they had pre-PR.
2. **Mandatory enrichment is opt-in via flag** (`--verify-experience` or equivalent). Default is current behavior (enrichment optional). New campaigns that want the tighter check pass the flag.
3. **Per-client ICP is opt-in via flag** (`--client <slug>`). Without the flag, yalc uses `gtm-os.yaml` as it does today.
4. **New gates only run if their preconditions are met:**
   - Drift check: only runs if experience-section enrichment was performed (otherwise no work_experience array to check)
   - Verified-employer ICP match: only runs if a per-client ICP was loaded (otherwise no `target_industries`/`disqualifiers` to match against)
5. **No schema changes to existing files that break older configs.** New fields in YAML schemas are optional. Missing fields are tolerated with sensible defaults.
6. **No removal of existing CLI flags or arguments.** Additions only.
7. **No renames.** Adding `getProfile(accountId, identifier, sections?)` was already done. Don't rename anything else.

---

## New pipeline (the "after") — numbered

```
PLAN PHASE
0. Resolve client ICP context (NEW, opt-in)
   - If --client <slug> passed:
     a. Try Notion: query for the client's "ICP & Qualification" page
     b. Fallback: read clients/<slug>.yml from a configured path (env var or CLI flag)
     c. Fallback: error loud with a clear message; do NOT silently proceed with generic YAML
   - If no --client, skip step 0 entirely; behave as today

INGEST
1. Pull leads from source (Sales Nav / Clay / CSV / Notion / post-scrape)
   — UNCHANGED
2. Dedup against existing campaignLeads
   — UNCHANGED

VERIFY
3. Unipile enrichment (CHANGED)
   - If --verify-experience flag passed:
     • Mandatory call to getProfile() with sections=['experience']
     • Extract: headline, work_experience[], primary_company (active role's company),
       primary_position, prior_companies[], current_role_start_date,
       ex_employer_markers[] (regex for "ex-X" in headline/about)
     • Source title/company become hints; verified fields take precedence in later gates
   - If flag not passed: behave as today (enrichment optional, only when fields missing)

QUALIFY
4. Headline regex (rules_path)            — UNCHANGED (runs against verified headline if available)
5. Exclusion regex (exclusion_path)       — UNCHANGED
6. Company disqualifier regex             — UNCHANGED behavior, but order MOVED to after enrichment
                                            so it runs against verified primary_company.
                                            (If --verify-experience not passed, runs against
                                            source company as before.)
7. Drift check (NEW, informational)       — Only runs if step 3 produced verified data.
                                            Sets a flag on the lead record:
                                            • drift.title_mismatch (source title != verified active role)
                                            • drift.ex_employer_in_headline (regex caught "ex-X")
                                            • drift.recent_role_change (current_role_start_date < 30 days ago)
                                            Does NOT auto-reject. Pure metadata.
8. Verified-employer ICP match (NEW)      — Only runs if per-client ICP was loaded in step 0.
                                            Uses verified primary_company.industry.
                                            HARD REJECT if industry is in icp.disqualifiers.
                                            HARD REJECT if industry is not in icp.target_industries
                                            (when target_industries is non-empty).
                                            Reason recorded on the rejection record.
9. AI qualification (Claude)              — UNCHANGED structure but prompt now receives
                                            client-specific ICP from step 0 if loaded
                                            (not generic gtm-os.yaml). Plus explicit rule:
                                            "If current_company.industry is on disqualifiers
                                            list, max score 30."

ROUTE
10. Score ≥ 50 → qualified, pushed to campaignLeads + Notion (UNCHANGED THRESHOLD)
11. Score < 50 → rejected (UNCHANGED)

   Drift flags from step 7 are written to the lead record but do not affect routing in v1.
   Manual-review surface is a separate PR.
```

---

## File-by-file changes

### Change 1 — Per-client ICP loader at plan time

**New file:** `src/lib/qualification/icp-loader.ts`

```ts
export interface ClientICP {
  client_slug: string
  source: 'notion' | 'yaml' | 'merged'
  primary_segment: {
    name: string
    target_roles: string[]
    target_industries: string[]
    target_company_sizes: string[]
    target_geographies: string[]   // defined now, enforced later
    disqualifiers: string[]         // industries / company patterns to hard-reject
    pain_points: string[]
    voice?: string
    messaging?: string
  }
  // additional segments allowed but only primary used in v1
}

export async function loadClientICP(slug: string, opts: {
  notionApiToken?: string
  notionPageIdResolver?: (slug: string) => Promise<string | null>
  yamlFallbackPath?: string  // e.g. ../earleads/clients/{slug}.yml
}): Promise<ClientICP>
```

Resolution order:
1. **Notion**: query for a page tagged with the client slug. Title pattern: `"ICP & Qualification — {client name}"`. Database is the Earleads `Clients` DB if available; configurable via env var `NOTION_CLIENT_ICP_DB_ID`. Required fields parsed: `Target Industries`, `Target Roles`, `Target Geographies`, `Disqualifiers`, `Primary Segment Name`. If the page exists but is missing a required field, **fail loud** at plan time (not silently at qualification time).
2. **YAML fallback**: if Notion fetch fails or `notionApiToken` not provided, read `<yamlFallbackPath>/<slug>.yml`. Same shape.
3. **Hard error if neither available**: when `--client <slug>` is passed but no ICP can be loaded, error with a clear message and exit. Do NOT silently fall through to `gtm-os.yaml`. (Reason: silent fallback is exactly the failure mode that caused C8.)

**Caller:** `src/lib/qualification/pipeline.ts:runQualify()` — add an optional `clientICP?: ClientICP` parameter on `QualifyOptions`. CLI passes it when `--client` flag is set.

**CLI integration:** wherever `leads:qualify` is wired up (find via `bin/` or `src/cli/` directory), add `--client <slug>` flag. Resolve via `loadClientICP()`. Pass into `runQualify()`.

### Change 2 — Mandatory enrichment with experience section

**Edit:** `src/lib/qualification/pipeline.ts` Gate 5 enrichment block.

Current behavior: enrichment is an `if (missing data)` branch. Change to:

```ts
if (opts.verifyExperience) {
  // Mandatory enrichment, all leads
  for (const lead of pipeline) {
    const profile = await registry.resolve('enrich', { ...inputs, sections: 'experience' })
    // existing extraction code...
    // PLUS new:
    lead.verified = extractVerifiedFields(profile)  // see below
  }
} else {
  // Existing optional behavior — UNCHANGED
}
```

**Edit:** `src/lib/providers/builtin/unipile-provider.ts` enrich step.

The `services/unipile.ts:getProfile()` already accepts `sections`. Just pass it through. Add a function:

```ts
function extractVerifiedFields(profile: UnipileProfile): VerifiedFields {
  const exp = profile.work_experience ?? []
  const active = exp.filter(e => !e.end)
  const primary = active[0]  // most recent active role
  return {
    headline: profile.headline,
    primary_company: primary?.company ?? null,
    primary_position: primary?.position ?? null,
    primary_company_industry: primary?.industry ?? null,  // if Unipile returns; otherwise null
    prior_companies: exp.slice(1).map(e => e.company).filter(Boolean),
    current_role_start_date: primary?.start ? parseDate(primary.start) : null,
    all_active_roles: active.map(e => ({ position: e.position, company: e.company })),
  }
}
```

**Throttle handling:** Unipile experience sections can be throttled. If `profile.throttled_sections` includes `'experience'` AND `work_experience` is empty, mark the lead with `verified.throttled = true` and **continue** with whatever data is available. Don't crash. The drift check (gate 7) will simply not fire for throttled leads.

### Change 3 — Drift check gate

**Edit:** `src/lib/qualification/pipeline.ts` — insert new gate after the (now-moved) company disqualifier gate, before AI qualification.

```ts
// Gate 7: Drift check (informational only, no rejections)
if (opts.verifyExperience) {
  for (const lead of pipeline) {
    if (!lead.verified || lead.verified.throttled) continue
    lead.drift = computeDriftFlags(lead)
    // Drift flags persist in the lead record but do not affect routing in v1.
  }
}
```

```ts
function computeDriftFlags(lead: LeadRecord): DriftFlags {
  const sourceTitle = (lead.source_title ?? '').toLowerCase()
  const verifiedPosition = (lead.verified.primary_position ?? '').toLowerCase()
  const headline = (lead.verified.headline ?? '')

  return {
    title_mismatch: sourceTitle && verifiedPosition && !looselyMatch(sourceTitle, verifiedPosition),
    ex_employer_in_headline: /\bex[-\s]([A-Z][\w &.,'-]{1,40})/.test(headline),
    recent_role_change: lead.verified.current_role_start_date
      ? daysSince(lead.verified.current_role_start_date) < 30
      : false,
  }
}
```

`looselyMatch()` should normalize and check token overlap (not exact match). E.g. "Sr. Director, Head of Sales - Retirement Services" should match "Senior Director Head of Sales".

### Change 4 — Verified-employer ICP match gate

**Edit:** `src/lib/qualification/pipeline.ts` — insert new gate after drift check, before AI qualification.

```ts
// Gate 8: Verified-employer ICP match (deterministic, only when client ICP loaded)
if (opts.clientICP && opts.verifyExperience) {
  for (const lead of pipeline) {
    if (!lead.verified || lead.verified.throttled) continue
    const company = lead.verified.primary_company
    const industry = lead.verified.primary_company_industry
    const icp = opts.clientICP.primary_segment

    // Hard reject: company name matches a disqualifier pattern
    if (company && matchesAnyPattern(company, icp.disqualifiers)) {
      lead.disqualified = { reason: 'company_in_disqualifiers', detail: company }
      continue
    }

    // Hard reject: industry on disqualifier list
    if (industry && matchesAnyPattern(industry, icp.disqualifiers)) {
      lead.disqualified = { reason: 'industry_in_disqualifiers', detail: industry }
      continue
    }

    // Hard reject: industry not in target list (when target list is non-empty)
    if (industry && icp.target_industries.length > 0
        && !matchesAnyPattern(industry, icp.target_industries)) {
      lead.disqualified = { reason: 'industry_not_in_target', detail: industry }
      continue
    }
  }
}
```

`matchesAnyPattern()` does case-insensitive substring + simple synonym match. Should handle `"Insurance"` matching `"insurance broker"` and `"HRIS"` matching `"HR information systems"`.

### Change 5 — AI prompt update (Gate 9)

**Edit:** `src/lib/providers/builtin/qualify-provider.ts` (the prompt template ~lines 49-66).

Two changes:
1. When `clientICP` is provided in context, inject **its** segment data (not generic `gtm-os.yaml`) into the prompt.
2. Add explicit rule to the prompt:
   > "If the lead's current company industry is in the disqualifiers list, score MUST be ≤ 30. If the lead's headline contains 'ex-[disqualified company]', flag and score ≤ 40. Be strict on industry match — when target_industries is specified, the current company's industry must clearly fit one of those listed."

### Change 6 — Reorder: company disqualifier runs after enrichment

**Edit:** `src/lib/qualification/pipeline.ts`. Move the existing Gate 3 (company disqualifier regex) call to AFTER the enrichment Gate 5. The reordering must be conditional: if `--verify-experience` flag was passed, run the disqualifier against `lead.verified.primary_company`. If not, run against source `lead.company` (current behavior).

This is a code-motion change; no logic change in the disqualifier rule itself.

---

## New schema additions

### Per-client ICP YAML schema (for fallback / non-Notion clients)

Path: configurable via `--icp-yaml-dir` flag or env `YALC_CLIENT_ICP_DIR`. Defaults to `./clients/`.

File: `<icp-dir>/<slug>.yml`

```yaml
client_slug: datascalehr
primary_segment:
  name: "HR-tech vendors with multi-country payroll"
  target_roles:
    - CRO
    - VP Sales
    - Head of Partnerships
    - Chief Commercial Officer
  target_industries:
    - Payroll software
    - HRIS
    - HCM software
    - System integrator
    - Global payroll provider
  target_company_sizes:
    - 1000+ employees
  target_geographies:    # defined for v1, not enforced until later PR
    - North America
    - Europe
  disqualifiers:
    - Insurance broker
    - Insurance / risk consulting
    - Real estate data
    - IT staffing
    - EOR (except Deel, Remote, Papaya Global, G-P)
  pain_points:
    - Multi-country payroll complexity
    - Implementation timeline as deal blocker
  voice: "..."
  messaging: "..."
```

### Notion schema (canonical source)

The Notion "ICP & Qualification" page per client must contain at minimum:
- Title: `"ICP & Qualification — {client name}"`
- Properties or sections (case-insensitive matching):
  - `Target Industries` (multi-select or comma-separated text)
  - `Target Roles` (multi-select)
  - `Target Geographies` (multi-select)
  - `Disqualifiers` (multi-select)
  - `Primary Segment Name` (text)

The loader fails loud if any of `Target Industries`, `Target Roles`, `Disqualifiers` are missing. `Target Geographies` is allowed empty in v1.

---

## Build approach (mandatory)

**Use sub-agents for any independent work.** A single agent burning through this whole build will produce uneven quality — some changes will be careful, others rushed when context fills. Decompose the build into sub-agent tasks before writing code.

Recommended decomposition (not prescriptive — adjust based on the codebase):

- **Sub-agent A — Types and interfaces.** Defines `ClientICP`, `VerifiedFields`, `DriftFlags`, updates `LeadRecord` to carry the new optional fields. Outputs a typed contract the other sub-agents conform to.
- **Sub-agent B — ICP loader.** Builds `src/lib/qualification/icp-loader.ts` with YAML loader first, Notion loader behind an interface. Stand-alone, fully tested.
- **Sub-agent C — Unipile provider extension.** Wires `sections=experience` through, adds `extractVerifiedFields()`, handles throttle markers.
- **Sub-agent D — Pipeline integration.** Reorders gates (change 6), adds Gate 7 (drift), Gate 8 (verified-employer ICP match), updates Gate 9 (AI prompt).
- **Sub-agent E — CLI integration.** Adds `--client` and `--verify-experience` flags; wires loaders into `runQualify()`.
- **Sub-agent F — Tests.** Backward-compat regression test (old invocation = old output), gold fixtures for new flags, drift-flag fixtures.

Each sub-agent should write its slice end-to-end (code + tests). After all sub-agents complete, a final integration pass verifies they compose correctly and all tests pass.

The orchestrator (the Claude that receives this spec) does not do the implementation work itself. It plans, dispatches, reviews, and integrates.

---

## Suggested implementation order (within the sub-agent decomposition)

1. Sub-agent A first (types) — everyone else depends on these.
2. Sub-agents B, C in parallel.
3. Sub-agent D next (depends on B and C).
4. Sub-agent E last for the user-facing surface.
5. Sub-agent F runs alongside D and E to lock in tests as code lands.

---

## Acceptance criteria

A run of `leads:qualify --source csv --input fixtures/datascalehr-c8-raw.csv --client datascalehr --verify-experience` should:

1. Successfully load `clients/datascalehr.yml` (or Notion equivalent) ICP.
2. Enrich every lead with experience section.
3. Reject the 16 insurance broker leads (Aon/Marsh/Gallagher/WTW) at gate 8 with reason `industry_in_disqualifiers` or `industry_not_in_target`.
4. Reject the 1 IT-staffing lead (Oxford Global Resources) at gate 8.
5. Set `drift.ex_employer_in_headline = true` on the Joe Bush "ex-UKG" record.
6. Set `drift.title_mismatch = true` on Casey Johnson, Matt Cardile, Ryan Ho records (employer change).
7. Pass through ~48 of the 93 source leads as qualified (the manually-validated "keep" set from the C8 audit).

A run of `leads:qualify --source csv --input fixtures/datascalehr-c8-raw.csv` (no flags) should produce the **same output as before this PR** — proving zero regression for existing workflows.

Both runs need automated tests. Use `gold-fixtures/` directory pattern that already exists in the repo.

---

## CTO non-negotiables

1. **Schema validation at plan time, not qualification time.** When `--client <slug>` is passed but the resolved ICP is missing required fields, error and exit before any leads are pulled. Don't silently degrade.
2. **No silent fallback from per-client ICP to generic YAML.** If `--client` is passed and ICP can't be loaded, hard fail. Generic-YAML fallback only happens when `--client` is NOT passed at all.
3. **Drift flags are persisted to the lead record** even though they don't affect routing in v1. Future review-queue PR consumes them; don't make it have to recompute.
4. **Throttled experience sections don't block qualification.** Mark `verified.throttled = true` and continue. Gate 8 should skip throttled leads (don't reject for missing data — that's not their fault).
5. **Reason strings are machine-readable.** When a lead is rejected at gate 8, store `disqualified.reason` as a stable enum string (`industry_in_disqualifiers`, `industry_not_in_target`, `company_in_disqualifiers`). Future analytics will group by these.
6. **Test coverage for backward compat.** A test fixture proving "old CLI invocation produces old output" is mandatory before merge.

---

## Open questions for the implementer

These are decisions the implementing Claude should make based on the codebase shape:

1. Does the existing `notionService` in `src/lib/services/notion.ts` cover ICP page reads, or does this PR need a thin new helper?
2. Where exactly is the `leads:qualify` CLI wired up? (`bin/` or `src/cli/`?) Add the new flags there.
3. Is `LeadRecord` typed in one place, or is there schema drift? The `verified` and `drift` fields need to live somewhere typed.
4. Are there existing fixture conventions for tests? Use them.
5. Should `target_industries` matching be exact, substring, or use a small synonym map? Recommend: case-insensitive substring + a hand-curated synonym map (`"HRIS" ↔ "HR information systems"`, `"insurance broker" ↔ "insurance"`). The implementer can decide whether to inline or extract this.

---

## Deployment note

This spec ships into **`yalc-internal`** first. Once the team has run it on at least one real campaign and validated it works, send a clean PR upstream to `Othmane-Khadri/YALC-the-GTM-operating-system` so OSS users benefit. The qualification pipeline files are byte-identical between internal and OSS today, so the upstream port should be straightforward.

The Notion-loader path is the only Earleads-specific bit. For OSS, ship just the YAML loader and an interface so other teams can plug in their own ICP source (Airtable, Google Sheets, Linear, whatever). The OSS PR can use a `ClientICPLoader` interface where the YAML loader is the default impl and Notion is documented as an example extension.

---

## Appendix A — C8 case study (for reference / test fixture seed)

The 93 leads from the C8 datascalehr campaign are the canonical test fixture. Sample failures the new pipeline must catch:

| Lead | Source company (HeyReach) | Verified company (Unipile experience) | Expected outcome |
|---|---|---|---|
| Casey Johnson | CoStar Group | UKG | Pass to AI; drift.title_mismatch=true; verified company is on-ICP |
| Matt Cardile | dighuman | UKG | Pass to AI; drift.title_mismatch=true; verified company is on-ICP |
| Ryan Ho | Oxford Global Resources | Paychex | Pass to AI; drift.title_mismatch=true; verified company is on-ICP |
| Joe Bush | UKG | UKG (but headline says "ex-UKG") | Pass to AI; drift.ex_employer_in_headline=true |
| Jackie Gilmore | Aon | Aon | Reject at gate 8; reason `industry_in_disqualifiers` (insurance broker) |
| Olaf Keller | Marsh | Marsh | Reject at gate 8; reason `industry_in_disqualifiers` |
| Elizabeth James | UKG | UKG | Pass to AI; AI scores low (RevOps title mismatch) — current behavior is fine |
| Melanie Christopher | Capgemini | Capgemini | Pass to AI; high score (Chief Sales Officer at SI) |

The full list (93 leads, decisions, page IDs) is in the Earleads Notion DB "C8 Lead Decisions (David review)" — `data_source_id: 84016149-42a0-44d9-b39e-cf3fba9d5c64`.

---

End of spec.
