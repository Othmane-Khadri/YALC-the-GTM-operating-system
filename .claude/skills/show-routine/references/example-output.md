# show-routine — example rendered output

```
Proposed sales routine (read-only preview — nothing installed)

Generated: 2026-04-30T18:15:00Z (deterministic — same inputs produce same output)

Frameworks:
  ✓ content-calendar-builder
      Schedule: weekly Mon 09:00 PT
      Rationale: Anthropic key + monitoring keywords present.

  ✓ outbound-signals-radar
      Schedule: daily 06:00 PT
      Rationale: Crustdata + PredictLeads available; signal-fit enabled.

  ⏸ outreach-campaign-builder  (deferred)
      Reason: no outbound hypothesis recorded yet.
      Unblock: run `framework:set-hypothesis outreach-campaign-builder ...`

Default dashboard: /dashboard/b

Archetypes covered: B (content-calendar) + C (outreach, deferred)

To install this routine, invoke the `build-routine` skill or run:
  yalc-gtm routine:install --yes
```
