# Role Prompts, Dynamic Buying Committee Generation

The committee depends on what the operator is selling and who the first contact is at the target company. There is NO baked-in default title mapping. The skill asks two clarifying questions before generating the committee, then runs a single LLM prompt that proposes the five slots in context.

## The five slots and their stable pain emphasis

The slot names and per-slot pain-emphasis labels are stable across deals. Only the title patterns and seniority tier change per deal.

| Slot | Pain emphasis (verbatim label) |
|---|---|
| Champion | user-pain story |
| EconomicBuyer | ROI math with specific dollar impact |
| TechnicalBuyer | integration and technical risk, concrete |
| User | daily friction, concrete |
| Blocker | procurement risk mitigation, concrete |

These labels are exported as `SLOT_PAIN_EMPHASIS` from `src/lib/committee/buying-committee-mapper.ts` and embedded verbatim in the prompt.

## Inputs to the role generation prompt

The orchestrator calls `buildRoleGenerationPrompt({ offer, firstContact, companyName, framework })`. Inputs:

- `offer.description`: one or two sentences captured in step 2. What is being sold and who feels the pain.
- `firstContact.raw`: the operator's free-text entry point at the company (LinkedIn URL, email, or "title and name") captured in step 3.
- `firstContact.resolved_title`, `firstContact.resolved_name`: populated when step 3 ran a Fiber lookup against a LinkedIn URL or email.
- `companyName`: the target company.
- `framework`: optional, loaded in step 4. Used as ICP hint context, NOT as a fixed title mapping.

## The dynamic role generation prompt

`buildRoleGenerationPrompt` returns this prompt verbatim:

```
You are mapping the five-person buying committee at a specific target company
for a specific deal. The committee depends on WHAT is being sold and WHO the
first contact is. Do not return generic titles. Propose titles that are
specific to this offer and this entry point.

TARGET COMPANY: {companyName}

OFFER (what is being sold and to whom):
{offer.description}

FIRST CONTACT (the entry point into the account):
  raw input:      {firstContact.raw}
  resolved name:  {firstContact.resolved_name | default: "(unknown name)"}
  resolved title: {firstContact.resolved_title | default: "(unknown title)"}

FRAMEWORK CONTEXT (use as hints, not as a fixed mapping):
  ICP:                 {framework.segments[0].name | default: "(no ICP loaded)"}
  targetRoles:         {framework.segments[0].targetRoles | default: []}
  keyDecisionMakers:   {framework.segments[0].keyDecisionMakers | default: []}

Produce a JSON array of exactly five entries, one per slot. Slots and
their pain emphasis (use these verbatim):
  - "Champion": pain emphasis = "user-pain story"
  - "EconomicBuyer": pain emphasis = "ROI math with specific dollar impact"
  - "TechnicalBuyer": pain emphasis = "integration and technical risk, concrete"
  - "User": pain emphasis = "daily friction, concrete"
  - "Blocker": pain emphasis = "procurement risk mitigation, concrete"

Each entry must have:
  - "slot":            one of Champion | EconomicBuyer | TechnicalBuyer | User | Blocker
  - "title_patterns":  2 to 3 exact job titles a search tool can match at this company
  - "seniority_tier":  one of "VP+" | "Manager" | "IC"
  - "pain_emphasis":   the pain emphasis label for that slot (verbatim from above)

Rules:
  - The first contact is part of the committee. Slot the first contact into
    whichever role best fits their resolved title; the other four slots are
    built around them.
  - Title patterns must be plausible at THIS company given the offer. Do not
    default to generic titles like "Director of Sales" or "CRO" unless they
    are the right fit for this deal.
  - seniority_tier routes the message to the right copywriting atom. Tier the
    title accordingly: C-level / VP go to VP+; Head / Director / Manager go
    to Manager; individual contributors go to IC.

Output strictly the JSON array. No prose.
```

The orchestrator then parses the JSON response via `parseGeneratedRoles` and shows the proposed mapping back to the operator with the verbatim confirmation prompt:

> Does this committee look right? Type 'yes' to proceed, or describe what to change.

On `yes`, proceed. On a free-text edit, re-run the generation prompt with the edit appended and re-ask.

## Voice spec for the per-persona copywriting atoms

When step 8 routes each contact to the right `copywriting-{tier}-sequence` atom, the orchestrator MUST pass:

- The resolved contact (name, title, company)
- The slot's `pain_emphasis` (verbatim from the table above)
- A single instruction line: `Write only the first email of the sequence; this is a single-touch outreach inside a five-thread committee campaign.`
- The voice rules block, passed verbatim as the `voice_rules` field. The block is exported as `VOICE_RULES` from `src/lib/committee/buying-committee-mapper.ts`:

```
Direct. Straight to the point. Lead with the value, not the introduction.
Data first, KPI driven. Anchor each message in a number or a concrete fact (industry benchmark, deal-size impact, time saved, error rate, conversion lift).
No fluff. No "I hope this finds you well", no "just reaching out", no "I came across your profile".
Some context, but only enough to put the value in perspective and earn trust. One sentence of "I noticed X about your situation" is enough.
Concrete. Use specific numbers, specific products, specific outcomes. Do not say "improve efficiency", say "cut your QBR prep from 4 hours to 30 minutes."
Per-persona angle stays: Champion gives a user-pain story; EconomicBuyer gets ROI math with specific dollar impact; TechnicalBuyer gets integration and technical risk, concrete; User gets daily friction, concrete; Blocker gets procurement risk mitigation, concrete.
One forward-looking question at the end. Not "let me know your thoughts."
No em-dash, no en-dash, no buzzwords (synergy, leverage, ecosystem, cutting-edge, best-in-class).
Do not start the body with the word "I".
```

The receiving copywriting atom produces a `{ subject, body }` calibrated to the tier and the voice rules.

## Dash-scan validator

Before the dryrun is written, every message body MUST pass:

```
/[–—]/.test(body) === false
```

No em-dash, no en-dash. ASCII hyphens are allowed inside compound words (rare). On a failure, the orchestrator regenerates that single message once; on a second failure it stops with an error.

## Voice acceptance checks

In addition to the dash-scan, the orchestrator runs two cheap voice checks on each body:

1. The body does NOT start with the word "I".
2. The body contains at least one numeric token (digits 0-9).

On failure, regenerate that single message once and re-check.
