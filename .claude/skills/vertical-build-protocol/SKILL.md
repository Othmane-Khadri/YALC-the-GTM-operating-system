---
name: vertical-build-protocol
description: Use BEFORE any non-trivial build, feature, PRD, MVP, or product work. Enforces three rules - (1) spec interview via AskUserQuestion then fresh session for execution, (2) phase-gated plan with unit + automation + integration tests per phase, (3) vertical-slice decomposition (tracer bullets crossing DB + service + UI) instead of horizontal phasing. Trigger phrases - "build", "implement", "ship", "PRD", "feature", "new product", "MVP", "let's build", "let's ship", "let's implement".
---

# Vertical Build Protocol

Three rules borrowed from Boris Cherny and the Claude Code community, bundled into one gate that fires before any non-trivial build.

<HARD-GATE>
Do NOT write code, scaffold files, invoke `superpowers:writing-plans`, `gsd:plan-phase`, or any implementation skill until ALL THREE rules below have been satisfied. This applies to every build that touches more than one file or one layer.
</HARD-GATE>

## When to skip

This skill is for builds. Skip the gate for:
- Single-line edits, typo fixes, rename refactors
- Pure research / read-only questions
- Operational tasks (run a script, check a status, query a DB)
- Skill / memory / config edits
- One-shot content tasks (write a post, draft an email)

If unsure, ask the user: "Is this a build, or a tweak?" Builds use the protocol. Tweaks don't.

## Defer to other skills

This skill does NOT replace existing planning skills — it adds discipline on top.
- For the interview itself, run alongside `superpowers:brainstorming` (it already enforces one-question-at-a-time).
- For writing the plan, invoke `superpowers:writing-plans` or `gsd:plan-phase`. This skill adds the structural requirements (vertical slices, multi-type tests) those skills must follow.
- For execution, the user starts a fresh session — at that point `superpowers:executing-plans` or `gsd:execute-phase` takes over.

## Checklist

Create a TodoWrite todo for each item. Complete in order.

1. Confirm this is a build (not a tweak) — if unsure, ask
2. Rule 1: spec interview via AskUserQuestion
3. Rule 1: write spec file
4. Rule 1: end session, instruct user to start fresh
5. (Fresh session) Rule 2: plan phases with unit + automation + integration tests each
6. (Fresh session) Rule 3: each phase is a vertical slice — verify before approving plan
7. Hand off to `superpowers:executing-plans` or `gsd:execute-phase`

## Rule 1: Spec interview → fresh session

**Why:** Interview turns pollute the cache and bias the model toward the first half-baked idea. A fresh session re-reads the spec as authoritative, with no relitigation of decisions.

**How:**

1. Take the user's minimal prompt as-is. Do NOT start designing.
2. Use `AskUserQuestion` to interview — one question at a time, max 4 options per question, multiSelect only when truly non-exclusive. Free-text questions are forbidden in this phase; if a question needs a free-text answer, find a way to scope it to options + "Other".
3. Stop interviewing when you have enough to write a single-page spec. Signs you have enough: scope is bounded, users named, success criterion stated, out-of-scope list exists.
4. Write the spec to `docs/specs/YYYY-MM-DD-<topic>.md` in the project root. For Earleads Second Brain projects without `docs/specs/`, use `04_AI_Agents/Specs/YYYY-MM-DD-<topic>.md`. For GTM-OS, use `docs/specs/`.
5. Show the user the spec path and end the session with this exact instruction:

   > **Spec is written at `<path>`. Start a fresh Claude Code session now. Paste this path as your first message: "Execute the spec at `<path>` using vertical-build-protocol Rules 2 and 3." This keeps the build context clean.**

6. Do NOT proceed to Rule 2 in the current session. The session ends here.

## Rule 2: Phase-gated plan with multi-type tests

**Why:** "We'll add tests later" never happens. Gating each phase on three test types forces the model to think about test scaffolding at plan time, not after the code exists.

**How:** When the fresh execution session begins, invoke `superpowers:writing-plans` (or `gsd:plan-phase` if a GSD project) to write the plan. Then enforce: every phase in the plan MUST list, explicitly, all three:

- **Unit tests** — function / component / pure logic level. Mocks allowed at this level.
- **Automation tests** — CLI script, smoke test, or e2e that exercises the slice end-to-end against the local dev environment. No mocks at boundaries you control.
- **Integration tests** — real services, real DB, real third-party APIs (or sandbox/staging equivalents). The thing that catches "it worked in dev."

A phase is "done" only when all three sets pass. If a test type genuinely doesn't apply (e.g. a pure docs phase), state explicitly in the plan *why* it doesn't apply. The default is all three apply.

Reject these exits:
- "We'll add integration tests once the service is up" → write the integration test now, mark phase blocked until the service exists, build the service in the same phase.
- "Unit tests cover this" → unit tests don't catch wire-up bugs. All three or document why.

## Rule 3: Vertical slices (tracer bullets)

**Why:** AI defaults to horizontal phasing — Phase 1 = DB schema, Phase 2 = service layer, Phase 3 = UI. This is the failure mode. You ship three phases of dead weight before any user sees anything work, and the integration between layers is left for the last phase where every bug is now an integration bug.

**Anti-pattern (do NOT do this):**

```
Phase 1: Set up DB schema for campaigns, variants, sends
Phase 2: Build CampaignService, VariantService, SendService
Phase 3: Build campaign list page, variant editor, send dashboard
```

**Correct pattern (vertical slices / tracer bullets):**

```
Phase 1 (walking skeleton): User clicks "New Campaign", a Campaign row is written to DB, a single hardcoded send is queued, user sees confirmation.
  - DB: one campaigns table, minimal columns
  - Service: createCampaign() + queueSend() — no abstractions
  - UI: one button + one confirmation toast
  - Tests: unit on createCampaign, automation script clicks the button, integration test queues a real send

Phase 2 (add variants): User can add 2 message variants, send picks one at random.
  - DB: variants table
  - Service: pickVariant()
  - UI: variant editor inline on campaign page
  - Tests: all three layers

Phase 3 (add tracking): Sends are tracked, user sees reply rate per variant.
  - DB: events table
  - Service: trackEvent(), variant stats
  - UI: stats column on campaign page
  - Tests: all three layers
```

Each slice ships an end-to-end user-visible capability. The first slice is the thinnest possible "walking skeleton" — one happy path, fully wired, ugly is fine.

**Concrete heuristic:** if you can demo a phase to the user as "click X, see Y," it's a vertical slice. If the demo is "look at this DB schema" or "look at this service interface," it's horizontal — split it differently.

**Phase ordering:** order slices by user-visible value, not technical dependency. If two slices depend on the same new piece of infrastructure, build the minimum infra needed for slice 1, then extend it during slice 2.

## Red flags

Thoughts that mean STOP — you're rationalizing out of the protocol:

| Thought | Reality |
|---------|---------|
| "This is a small feature, the protocol is overkill" | Small features have small protocols (short interview, 1-2 slices). Run it anyway. |
| "Let me just sketch the DB schema first" | That's horizontal. Find the user-visible slice first; the schema falls out of it. |
| "We'll write integration tests after the first deploy" | No. Write them in the same phase or document why they don't apply. |
| "The user already told me what they want, I don't need to interview" | Re-read the prompt. There are 5 unanswered questions hidden in any "minimal" prompt. Interview anyway. |
| "Continuing in the same session is fine, no need for a fresh one" | The fresh session is the whole point of Rule 1. Don't skip it. |
| "I'll combine Phase 1 (DB) and Phase 2 (service) to save time" | That's still horizontal — you're just calling two horizontal phases one phase. Fix the slicing, not the count. |
| "The user is in a hurry, let me just start coding" | Bad outcomes are slower than good process. Protocol stays on. |
