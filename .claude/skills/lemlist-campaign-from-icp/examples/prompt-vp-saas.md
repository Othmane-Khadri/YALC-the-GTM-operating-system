# Example: VP-level SaaS prospect campaign

## Input prompt (one line in Claude Code)

```
create a lemlist campaign for VPs of Sales at Series B SaaS companies in Europe
that are hiring Account Executives. Our product helps RevOps teams cut quota
ramp time from 6 months to 3. 50 leads, paused.
```

## What the skill does

1. Parses the prompt:
   - **ICP:** Series B SaaS, Europe, hiring AEs
   - **Persona:** VP of Sales
   - **Product context:** RevOps tool, cuts quota ramp time from 6mo to 3mo
   - **Ceiling:** 50 leads
2. Runs the 25-stage chain (see `SKILL.md`).
3. Writes the dryrun to `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`.
4. Asks for `approve` before pushing to lemlist.

## Expected dryrun shape

See `dryrun-output-sample.json` in this directory.

## Expected campaign in lemlist (after approval)

- Title: `[Yalc] VP Sales Series B SaaS EU – AE hiring trigger`
- State: **PAUSED**
- Leads: 50 (sourced via `lemleads_search`, agentically enriched)
- Sequence: 3-email VP-routed (via `copywriting-vp-sequence`)
- Opener angle: AE hiring signal + quota ramp pain
- CTAs: value-based (designed by `cta-designer`)
- Quality score: surfaced from `copywriting-analyzer`

## Typical timing

Sourcing + enrichment: 2–3 min
Reasoning + writing: 1–2 min
Quality gate + dryrun: 30 sec
**Total to dryrun: ~5 min.**
Approval + push: 30 sec.
