# Routine Generator Design Spec

**Status:** Design spec — v1 proposal
**Date:** 2026-05-01
**Owner:** YALC GTM-OS core
**Branch:** `wt/c1-routine-spec`

## 1. Goal + non-goals

Today the last mile of `yalc-gtm start` is manual. After flag-capture, profile review, and key wiring, the user lands in Step 9 of `setup.md`, is walked through `framework:recommend`, and has to interactively `framework:install <name>` for each framework, accepting or overriding inputs one at a time. They then jump to Step 10 to install `outreach-campaign-builder` (only if a channel key is present) and capture an outbound hypothesis. By Step 11 they've made roughly a dozen micro-decisions — most of which the system already had enough information to answer.

The Routine Generator collapses that surface into a single yes/no. Concrete user story: *after I run `yalc-gtm start` and finish review, the system proposes a complete routine — frameworks installed, schedules set, dashboard chosen — and I confirm with one prompt.* The generator is rule-based, deterministic, and inspectable; it reads the same `RecommendationEnvironment` `recommend.ts` reads, derives a `Routine`, and either prints or applies it. **Non-goals:** replacing the human-in-the-loop gates inside frameworks (every `gate:` still fires at run time), auto-running campaigns without confirmation, training a recommendation model. The generator chooses *what to install*, not *what to send*.

## 2. Inputs + signals

The generator reads four inputs, all already present at the end of `yalc-gtm start`:

1. **Resolved capabilities** — the projection of `adapters:list` (built-in TS + declarative manifests under `~/.gtm-os/adapters/` and bundled `providers/`): *which provider ids are available right now*. A provider is "available" when `isAvailable()` returns true (env vars set + adapter registered), per `src/lib/providers/capabilities.ts`. We reuse `RecommendationEnvironment.providers` so the generator unit-tests in isolation.
2. **Archetype (A/B/C/D)** — derived from the four shipped frameworks. **A** = `competitor-audience-mining` (LinkedIn engagement-driven inbound), **B** = `content-calendar-builder` (weekly content cadence), **C** = `outreach-campaign-builder` (hypothesis-led outbound), **D** = `lead-magnet-builder`. Labels match the existing `archetype-*.test.ts` integration tests. A user usually maps to *more than one* archetype — the generator selects the set, not a single winner.
3. **`CompanyContext` rich fields** — read via `loadCompanyContext()`. Inspected: `icp.competitors` and `icp.competitors_detail` (drive A), `icp.segments_detail` and `icp.pain_points` (drive B/C eligibility), `signals.buyingIntentSignals` and `signals.monitoringKeywords` (sharpen A and B), `sources.linkedin_account_id` (gates anything Unipile-touching).
4. **Channel preference (optional)** — if Step 10 captured a hypothesis, read `~/.gtm-os/frameworks/installed/outreach-campaign-builder.json` and treat the user as having an explicit outbound preference (channel = linkedin or email). No sidecar = no preference asserted; the generator falls back to capability presence.

The generator never makes network calls and never invokes an LLM. Determinism is the design constraint — same inputs, same routine, every time, so the SPA can preview the proposal before the user confirms.

## 3. Output: a `Routine` object

The proposal is a single value the CLI can serialize, the SPA can render, and the apply step can replay:

```ts
export interface RoutineFrameworkEntry {
  framework: string                 // matches a configs/frameworks/*.yaml name
  schedule?: { cron: string; timezone?: string } // omitted for mode: on-demand
  inputs?: Record<string, unknown>  // overrides for the framework's `inputs:` block
  rationale: string                 // one human-readable line — why this was chosen
}
export interface Routine {
  version: 1
  generatedAt: string               // ISO timestamp
  archetypes: Array<'A' | 'B' | 'C' | 'D'>
  frameworks: RoutineFrameworkEntry[]
  defaultDashboard: string          // e.g. "/frameworks/competitor-audience-mining"
  notes: string[]                   // generator-level rationale (capability gaps, conflicts resolved)
}
```

The shape is a versioned plain object; no class, no methods. Every entry is reproducible by re-running the rule pipeline. The `rationale` field is mandatory so the SPA review surface can answer "why is this here?" without re-querying the engine.

## 4. Generation rules

The pipeline is four stages: (1) compute archetype set, (2) for each framework run the eligibility predicate, (3) resolve schedule + inputs from defaults, (4) resolve conflicts and pick a default dashboard. Each stage is a pure function; no I/O after `gatherEnvironment()` returns.

### 4.1 Per-framework eligibility predicate

Signature: `canRunWith(capabilitiesAvailable: string[], archetype: ArchetypeSet, context: CompanyContext | null) → boolean`.

The predicate reuses the existing `requires` block evaluation from `recommend.ts` (so adding `requires` fields in a yaml automatically reaches the routine generator) and layers four routine-specific gates on top:

- **`competitor-audience-mining` (A):** requires provider `unipile`, requires key `ANTHROPIC_API_KEY`, requires `context.icp.competitors.length > 0` OR a non-empty `competitors_detail`. Routine-specific gate: also requires `context.sources.linkedin_account_id` to be set — without it the cron job will warn under doctor and the seed run will fail.
- **`content-calendar-builder` (B):** requires `ANTHROPIC_API_KEY`. Routine-specific gate: at least one of `unipile` (LinkedIn trending) OR a non-empty `signals.monitoringKeywords` (so `detect-news` has something to query). If both are absent, the framework will run but produce empty drafts — exclude it.
- **`outreach-campaign-builder` (C):** requires `ANTHROPIC_API_KEY` AND at least one outbound channel — `unipile` OR provider `instantly`. Routine-specific gate: only auto-install if the user already locked a hypothesis (`hypothesis.icp_segment.length > 0` in the installed sidecar). If no hypothesis exists, the generator emits a *deferred* entry — see §4.4 — telling the SPA to surface the Step 10 wizard rather than pre-committing.
- **`lead-magnet-builder` (D):** requires `ANTHROPIC_API_KEY`. Always eligible when the key is present.

Two more frameworks are anticipated as the catalog grows (visitor-qualification, signal-driven-touch). They follow the same predicate shape, so adding them is one yaml + one entry in the rule table — no engine refactor.

### 4.2 Schedule defaults

Defaults come from each yaml's `schedule.cron`; the generator prefers the yaml-declared value over any computed schedule. When the yaml leaves cron empty (i.e. `mode: on-demand`), the routine entry omits the `schedule` field entirely. When the yaml *does* declare cron but the user already has another framework on the same minute (within ±5 minutes — read from currently-installed agent yamls), the generator nudges the new entry by +15 minutes to spread launchd load. Cron stays in the yaml's declared timezone (or `$context.company.timezone` resolved to UTC by `cron-conversion.ts`).

### 4.3 Dashboard defaults per archetype

The default dashboard route is the *primary* archetype's framework route. Primary is chosen by this order: A > B > C > D when multiple are eligible — A surfaces the highest-signal action item (qualified engagers ready for outreach), so it earns the landing page. The full mapping:

- A primary → `/frameworks/competitor-audience-mining`
- B primary → `/frameworks/content-calendar-builder`
- C primary → `/frameworks/outreach-campaign-builder`
- D primary → `/frameworks/lead-magnet-builder`

If zero archetypes match, default dashboard falls back to `/frameworks` (the index view) and a note is emitted.

### 4.4 Conflict resolution

The two known conflicts:

- **C vs B for the "weekly content cadence" slot.** If a user has both a hypothesis locked AND `unipile` configured, both C and B are eligible. The generator installs both (they don't actually conflict on schedule — C is on-demand, B is Monday 09:00). It only emits a `note` clarifying that the Monday LinkedIn slot is owned by content drafting and any LinkedIn outreach happens at the user's pace via C.
- **C without a hypothesis.** When C is otherwise eligible but no hypothesis is locked, the routine includes C as an entry with `inputs: { hypothesis: '<deferred>' }` and a rationale of `"Awaiting hypothesis — install will pause at Step 10 of setup."` `routine:install` then routes to the existing Step 10 conversational wizard rather than running with an empty hypothesis.

### 4.5 Edge cases

- **Zero providers configured (only `ANTHROPIC_API_KEY` present).** Only D is eligible. The routine has a single framework entry (`lead-magnet-builder`), default dashboard `/frameworks/lead-magnet-builder`, and one note recommending the user run `provider:add unipile` to unlock A/B.
- **Only reasoning capability (no Anthropic, no providers).** The routine is empty. The generator returns `frameworks: []`, default dashboard `/frameworks`, and a note: `"No reasoning provider — set ANTHROPIC_API_KEY (or add an MCP reasoning provider) and re-run routine:propose."` `routine:install` is a no-op in this state.
- **Archetype unknown (no matching predicate fires).** Same as the empty case — empty frameworks, fallback dashboard, explanatory note. The generator never throws.

## 5. Surface (CLI + SPA)

### CLI

- `yalc-gtm routine:propose` — runs the rule pipeline and prints the proposed `Routine` to stdout. Default output is human-readable (a numbered list of frameworks with rationale lines, schedules, default dashboard, notes). `--json` switches to a single-line JSON dump for SPA consumption. Exit 0 on success, exit 2 when no Anthropic key is set (the empty-routine case still renders, but exit 2 signals "nothing to install"). The command is read-only — it never writes to `~/.gtm-os`.
- `yalc-gtm routine:install` — applies the proposed Routine. Runs `routine:propose` internally to recompute (so a stale proposal can't drift into install), then calls `framework:install --auto-confirm` per entry, writes the schedule files via the existing agent-runner path, and updates `~/.gtm-os/config.yaml`'s `dashboard.default_route` to the routine's `defaultDashboard`. Supports `--dry-run` (print the actions, don't execute) and `--only <framework>` (install a subset). Always idempotent: re-running it after a successful install is a no-op when the inputs haven't changed.

### SPA — setup.md Step 11

A new Step 11 lands between current Step 10 (outbound hypothesis) and the existing hand-off (now Step 12). Step 11:

1. Calls `yalc-gtm routine:propose --json`.
2. Renders the human-readable preview to the user — frameworks, schedules, dashboard, notes.
3. Asks one prompt: `"Install this routine? (yes / show details / skip)"`.
4. On `yes`, calls `routine:install`, prints the `framework:install` exit lines, and continues to hand-off.
5. On `show details`, expands each entry with its yaml description + rationale, then re-asks the prompt.
6. On `skip`, prints the existing Step 11 hand-off summary unchanged. The proposal is *not* persisted on skip — re-running setup re-derives.

This preserves the human-in-the-loop principle (every framework still has its `gate:` blocks, every install runs its `seed_run` once) while collapsing the upfront decision count from a dozen prompts to one.

## 6. Persistence

The chosen Routine is persisted to a sidecar at `~/.gtm-os/routine.yaml` rather than embedded in `~/.gtm-os/config.yaml`. Reasoning: `config.yaml` is the *resolved* state (priorities, default dashboard, tenant settings) — it should stay small and human-edited. `routine.yaml` is a *snapshot* of generator output, captured at install time, so a future `routine:diff` can compare the current proposal against what was last installed. Storing the snapshot also means we can show "you installed this routine on YYYY-MM-DD" in the SPA without re-deriving.

The sidecar holds the full `Routine` cast to YAML plus a `routine_meta:` block (`installed_at`, YALC version, frameworks skipped via `--only`). It is *not* the source of truth for installed frameworks — that remains `~/.gtm-os/frameworks/installed/<name>.json`. The sidecar is advisory; deleting it has no functional effect.

**Re-run semantics.** Running `routine:propose` again recomputes from current state. If the new proposal matches the sidecar, the CLI prints `"Routine unchanged."` and exits 0. If it differs, the CLI prints the diff (added/removed frameworks, schedule changes) and recommends `routine:install --diff-only` — applies the delta only. This is the upgrade path when the user adds a provider or captures fresh signals later.

## 7. Versioning

The `Routine` schema carries `version: 1`. Strategy for evolving the rule set without breaking installs:

- **Schema bumps** (renaming/adding required fields) increment the `version` integer and ship a migration in `src/lib/onboarding/migrate.ts` (same module that migrated `company_context.yaml` 0.5 → 0.6). The migration runs on `routine:propose` when the sidecar version is older than the generator's.
- **Rule additions** (new framework, new predicate) do *not* bump the version — they're additive. The generator emits a note when re-derivation produces a different routine because of a new rule, so the user can audit before re-installing.
- **Rule changes** (tightening a predicate) are gated by a feature flag in the rule table and only become default in a minor release. Avoids "I re-ran propose and now my routine is empty."

The generator always emits the *current* `version`; older sidecars are read for diffing only.

## 8. Test plan

- **Unit tests per predicate.** One file per archetype (A/B/C/D), mirroring the existing `archetype-*.test.ts` layout. Each file covers: predicate true with full env, predicate false with missing provider, predicate false with missing context field, predicate false with empty Anthropic key. Use `gatherEnvironment({ providers, envKeys, context, installed })` so no actual `~/.gtm-os` is touched.
- **Snapshot tests for `routine:propose` output** across 6–8 archetype × provider matrix combinations: empty env, Anthropic-only, Anthropic + Unipile, Anthropic + Unipile + competitors_detail, Anthropic + Instantly + locked hypothesis, Anthropic + Unipile + Instantly + hypothesis, full env (all providers + rich context), full env minus `linkedin_account_id`. Stored under `src/__tests__/__snapshots__/routine-generator.snap`.
- **E2E test:** full setup flow against a fixture context (`fixtures/routine/full-context.yaml`), mock the framework install pipeline (stub out launchd writes — reuse the pattern from `archetype-competitor-audience-mining.test.ts`), assert that the right cron expressions land in the agent yamls and that `~/.gtm-os/routine.yaml` is written with the expected snapshot.
- **Conflict resolution tests:** specifically the C-without-hypothesis deferral, the A+B+C dashboard primary picker, the schedule-nudge when two frameworks collide on a cron minute.

## 9. Out of scope (v1)

Not in v1: multi-routine support (separate "client A" and "client B" routines under the same tenant — keep one per tenant), routine sharing across teams (requires an export format and a trust boundary we haven't designed), routine optimization based on past run results (would need a scoring loop on `*.runs/*.json`), ML-driven recommendations (the whole point of the rule-based engine is auditability), scheduled re-evaluation when new providers come online (the user opts into re-derivation by re-running `routine:propose` — we don't watch the env). All five are reachable from v1's foundation; deferring them keeps the first ship deterministic and small.
