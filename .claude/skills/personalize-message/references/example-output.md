# personalize-message — example rendered output

Below is what the user sees after `personalize-message` runs against a single lead with a typical outbound template.

## Input

**Template:**
```
Hi {{first_name}} — saw {{company}} just hired their first {{ic_team}} engineer. Curious how you're handling {{pain_point}} now that the team is scaling.

Worth a 15-minute call?
```

**Lead:** `sarah.chen@acmecorp.com` (with `--enrich` flag)

## CLI invocation

```bash
npx tsx src/cli/index.ts personalize \
  --template "Hi {{first_name}} ..." \
  --email sarah.chen@acmecorp.com \
  --enrich
```

## CLI output (last block)

```
✓ Personalized variant generated
  Lead: Sarah Chen — VP Marketing @ Acme Corp
  Channel: email
  Cost: 1,847 input + 312 output tokens (~$0.011)

Variant:
---
Hi Sarah,

Saw Acme just hired your first marketing-ops engineer last week — that's
usually the moment attribution stops being a fire drill. Curious how
you're handling lead routing across the new team given Acme's segment-
based GTM motion.

Worth a 15-minute call?
---

Reasoning:
  - Pulled Sarah's title (VP Marketing) from Crustdata.
  - Detected the marketing-ops engineer hire from PredictLeads (3 days ago).
  - Acme's segment-based GTM motion sourced from their /pricing page (Firecrawl).
  - Pain point inferred: "lead routing across new team" matches the {{pain_point}} slot.
```

## Skill summary rendered to user

```
Personalized variant for Sarah Chen (VP Marketing @ Acme Corp):

  Hi Sarah,

  Saw Acme just hired your first marketing-ops engineer last week — that's
  usually the moment attribution stops being a fire drill. Curious how
  you're handling lead routing across the new team given Acme's segment-
  based GTM motion.

  Worth a 15-minute call?

Why this opener:
  • Title sourced from Crustdata (VP Marketing — exact match).
  • Hire signal: marketing-ops engineer joined 3 days ago (PredictLeads).
  • Acme's segment-based GTM motion read off their /pricing page (Firecrawl).
  • {{pain_point}} resolved to "lead routing across new team."

Cost: 2,159 tokens (~$0.011).

Want me to:
  (a) regenerate with a different angle?
  (b) batch-personalize this template across a result set?
  (c) pipe this into a LinkedIn campaign via `launch-linkedin-campaign`?
```

## Failure modes

### Anthropic key missing

```
personalize failed (exit 1):

Error: ANTHROPIC_API_KEY is not set.

To fix: edit ~/.gtm-os/.env and re-run.
```

### Lead not found (with --enrich)

```
personalize failed (exit 2):

Error: No profile found for sarah.chen@acmecorp.com via Crustdata.

Try one of:
  --linkedin-url <url>
  --first-name <name> --company <name>
```

### Template missing required slot

```
⚠ Template references {{ic_team}} but no resolver returned a value.
Variant generated with the slot left blank — review before sending.
```
