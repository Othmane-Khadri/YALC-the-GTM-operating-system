# YALC — Product Direction

**Author:** Othmane (Founder & CEO, Earleads)
**Updated:** March 2026

---

## 1. What We're Building

### The One-Line Vision
An open-source, AI-native operating system for running any GTM campaign — where the primary interface is the CLI, and intelligence compounds from every interaction.

### What This Is NOT
- Not a Clay clone. Clay is a spreadsheet with enrichment columns. We are an intelligence layer that orchestrates campaigns.
- Not a CRM. We don't store relationship history. We orchestrate multi-channel outreach.
- Not a no-code automation tool. We're a reasoning engine that builds and executes GTM workflows.

### What This IS
A CLI-first framework to operate any GTM campaign. The user describes an outcome in natural language or through structured commands. The system proposes workflows — data sources, enrichment steps, qualification criteria — all informed by the user's framework. Results flow into an intelligence store that gets smarter with every campaign outcome.

> **CORE THESIS:** Intelligence is available at every step. The user's framework is the differentiator. Every campaign outcome feeds back into the system.

---

## 2. Core Principles

### CLI-First, Library-Second
YALC ships as a CLI (`pnpm cli -- <command>`) and a TypeScript library (`import { createGtmOS } from 'gtm-os'`). No web UI required. Dashboards exist for visualization but are not the primary interface.

### AI-Native Intelligence
- **Workflow construction:** AI plans campaigns from natural language
- **Qualification:** 7-gate pipeline with LLM reasoning against the framework
- **Personalization:** Auto-personalize outreach using lead context + winning angles
- **Feedback loops:** Campaign outcomes automatically feed the intelligence store

### Framework-Aware
The GTM Framework is the living intelligence layer:
- ICP segments with pain points, messaging angles, objections
- Competitive positioning
- Channel-specific learnings
- Confidence-scored intelligence entries that promote from hypothesis → validated → proven

### Campaign-as-Hypothesis
Every campaign starts with a hypothesis. Variants test different angles. Statistical significance determines winners. The intelligence store captures what worked and why.

---

## 3. Architecture

### Three-Layer Pattern (Non-Negotiable)
```
Service (API wrapper) → Provider (StepExecutor) → Skill (user-facing operation)
```

Never skip layers. Services handle auth and API calls. Providers implement the `StepExecutor` interface with `canExecute()` for auto-routing. Skills yield `SkillEvent` streams for progress reporting and approval gates.

### Provider Auto-Resolution
The provider registry resolves the best executor for a given step:
1. Exact ID match
2. Normalized ID match (case-insensitive, strip hyphens)
3. Capability match (prefer builtin over mock)
4. Error with Levenshtein suggestion (never silent mock fallback)

### Intelligence Store
Structured insights with evidence, bias checks, and confidence scoring:
- **Hypothesis** → **Validated** → **Proven** lifecycle
- Auto-promotion based on evidence thresholds
- Segment and channel scoping
- Injected into AI prompts for context-aware decisions

### Rate Limiting
DB-backed token bucket rate limiter. Every external send (LinkedIn connects, DMs, emails) goes through `rateLimiter.acquire()`. Limits are configurable per provider per account.

### Outbound Validation
Every human-facing message passes through `validateMessage()`. Hard violations block sends. No exceptions.

---

## 4. Multi-Channel Roadmap

### Phase 1: LinkedIn (Shipped)
Unipile-powered. Connect → DM1 → DM2 sequence. A/B variant testing. Campaign tracker with daily polling.

### Phase 2: Cold Email (Instantly.ai)
Service + provider + skill. Multi-step sequences. Open/reply/bounce tracking. Rate limited per sending account.

### Phase 3: Multi-Channel Orchestrator
YAML-defined sequences spanning LinkedIn + email + Twitter. Condition-based branching (e.g., "if replied_email, skip DM2").

### Phase 4: Intelligence & Personalization
Auto-personalization using lead context. A/B test statistical significance (chi-squared). Competitive intelligence skill.

### Phase 5: Plugin System
`YALCPlugin` interface. Auto-discovery from `./plugins/` or `gtm-os.yaml`. Plugin-provided providers and skills auto-register.

### Future: HubSpot CRM, Dialer, Twitter, Webhooks, Signals, Multi-User

---

## 5. Success Criteria

A solo founder can:
1. Clone the repo and run locally
2. Add API keys via `pnpm cli -- setup`
3. Import leads from CSV
4. Run 7-gate qualification with `--dry-run`
5. Create a multi-variant campaign
6. Track outcomes and see intelligence accumulate
7. Generate a monthly intelligence report

> **THE LITMUS TEST:** If a GTM engineer can go from `git clone` to a qualified lead list with campaign running in under 15 minutes — we've shipped something worth starring.
