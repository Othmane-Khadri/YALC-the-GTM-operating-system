# Executive Resolution

How the `signal-to-call` skill turns a job posting into a verified
mobile contact in HubSpot. This file documents three small algorithms
that the skill follows at runtime.

## 1. Persona selection from `loadFramework`

The framework returned by `loadFramework(tenantId)` exposes
`segments[]` (`ICPSegment` from `src/lib/framework/types.ts`). Each
segment carries `targetRoles[]` and `keyDecisionMakers[]`. The skill
resolves the persona segment that owns the posted role like this.

Inputs:
- `posted_role` (string) - the role string from stage 1.
- `framework.segments[]` (`ICPSegment[]`) - from `loadFramework`.

Algorithm:

1. Lowercase `posted_role`.
2. For each segment in priority order (`primary` first, then
   `secondary`, then `exploratory`), check for an exact case-insensitive
   match in `targetRoles` or `keyDecisionMakers`. If a match is found,
   return `{segment_id, segment_name, seniority}`.
3. If no exact match, tokenize the role (drop stop tokens: `at`,
   `of`, `the`, `a`, `an`, `for`). Compute the token-overlap score
   against each segment's `targetRoles` (sum of overlapping tokens).
   Pick the highest-scoring segment.
4. If the top score is zero, return `null` and halt the skill with
   `persona_unresolved`.

Seniority derivation (independent of segment match):

```
if /^(vp|svp|chief|head of)\b/i.test(role)        -> 'executive'
else if /^(director|manager|lead)\b/i.test(role)  -> 'manager'
else                                              -> 'ic'
```

## 2. Fiber search query construction

The `people-search` capability via the Fiber adapter accepts
`{query, company_name, title, limit}`. The skill builds them like
this:

- `company_name`: the resolved company name (the framework lookup may
  surface a canonical name; otherwise the host of `company_domain`
  with the TLD stripped, capitalized).
- `title`: the posted role (passed through verbatim, e.g. `VP
  Engineering`).
- `query`: `"<title> at <company_name>"`. The free-text field; Fiber
  uses it as a fallback search hint.
- `limit`: 5. The skill takes the top result with a non-empty
  `linkedin_url`.

Seniority is NOT passed to Fiber as a separate filter (the manifest
does not expose one). It is captured at stage 3 and threaded forward
for the opener template and the dryrun JSON.

If the response is empty for the company, the skill halts with
`no_contact_found`. The operator broadens the role pattern and retries.
No fallback to other people providers in v1.0.0.

## 3. Opener template

The opener is a single-line phone-call opener written in the
operator's voice. The skill renders it from this template and then
validates it against `OUTBOUND_RULES`.

Prompt the model uses to generate the opener:

```
You are drafting a single-line phone-call opener for an outbound
cold call.

Inputs:
- Contact: {firstname} {lastname}, {role} at {company}.
- Signal: the role was opened publicly. Source: {source_url}.
- Persona seniority: {seniority} (executive | manager | ic).

Rules:
1. One sentence. Maximum 25 words.
2. Tie the opener to the hiring signal (a new role opening tells
   you something specific about the buyer's problem). Be concrete.
3. No em-dash, no en-dash, no " - " punctuation. Use commas or
   periods.
4. Do not start with "I".
5. No buzzwords (cutting-edge, synergy, leverage, ecosystem).
6. Do not name a product or a vendor. Frame the value as a hypothesis
   the contact will recognize.
7. End on a specific reason to talk (a question, a thirty-second
   value claim, or a concrete observation), never with "let me know
   your thoughts".
```

Example outputs (for shape, not copy):

- Executive seniority, VP Engineering signal: `Hello {firstname},
  noticed the VP Engineering opening at {company}, calling to share
  one pattern we see in scaling teams from forty to two hundred
  engineers.`
- Manager seniority, Director Demand Gen signal: `Hello
  {firstname}, the Director Demand Gen post tells me you are
  rebuilding pipeline coverage, one thirty-second pattern that might
  save a quarter.`
- IC seniority, AE signal: `Hello {firstname}, the AE opening at
  {company} suggests a quota retire problem, calling with one
  observation about ramp time.`

After generation, the skill runs the opener through
`OUTBOUND_RULES.find(r => r.id === 'no-dash-punctuation').check`. If
the rule returns `false`, regenerate the opener once with an even
stricter prompt ("dash count must be exactly zero"). On second
failure, the skill halts with `opener_failed_validation`.

## 4. Business-hours SLA

The skill's 12 hour SLA shifts to the next business morning in the prospect's local timezone when the signal arrives outside working hours. The rule is:

```
dueAt = min(now + 12h, next business day 09:00 in prospect's local tz)
```

Where "next business day" is the next Mon-to-Fri calendar day in the prospect's tz strictly after `now`. The prospect's tz comes from the Fiber result's `location` field via the small country-to-tz map in `src/lib/skills/signal-to-call/orchestrator.ts` (`timezoneForCountry`). Unknown country defaults to `America/New_York`.

Concrete behavior across the four corner cases:

| Signal arrival (local) | Country | Result |
|---|---|---|
| Tue 10:00 ET | US | now+12h (22:00 same day; well before 09:00 next morning, ceiling wins) |
| Tue 19:00 ET | US | now+12h (07:00 next day; sooner than 09:00 next day, ceiling wins) |
| Tue 23:00 ET | US | next-day 09:00 ET (12h would be 11:00, but 09:00 is sooner once both are after midnight; 09:00 next day wins) |
| Fri 23:00 ET | US | Mon 09:00 ET (12h would be Sat 11:00; weekend skipped, Mon morning wins) |
| Wed 14:00 CET | DE | now+12h (02:00 next day; ceiling wins; no shift inside the working day) |

Implementation lives in `computeDueAt(now, prospectCountryCode?)`. The function uses `Intl.DateTimeFormat` to read the prospect's local wall-clock components and walks forward day by day skipping weekends. The 12-hour ceiling is computed in UTC and compared directly to the candidate next-business-morning instant.

Phone-related fallback is FullEnrich-only (see section 5 below). Fiber is search-only in this skill.

## 5. Phone availability fallback

The skill calls FullEnrich for the verified mobile. When FullEnrich
returns no mobile for the contact, the skill gracefully degrades to
email-first outreach:

1. The skill sets `phone: null` in the dryrun and the HubSpot upsert
   payload.
2. The skill sets `phone_unavailable_reason: 'no_verified_mobile_returned'`
   in the dryrun and surfaces the line in the Slack DM.
3. The HubSpot task is still created with the same SLA. The subject
   becomes `Email {firstname} re: {role}` (email-first) and the body
   is reframed as an email opener.
4. The opener is regenerated with a prompt that says "first-line of
   a cold email, not a phone-call opener". Same validation rules
   apply.

No fallback to other people providers in v1.0.0. Fiber for search,
FullEnrich for enrichment.
