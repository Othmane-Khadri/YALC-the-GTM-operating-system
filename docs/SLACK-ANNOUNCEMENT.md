# Slack announcement draft

Copy-paste into #gtm-os or wherever the team lives.

---

:rocket: **GTM-OS update — Clay Gap release**

Pushed a big update today. It closes the gaps between GTM-OS and Clay, plus hardens everything we already use daily.

**To update (30 seconds):**
```
npx tsx src/cli/index.ts update
npx tsx src/cli/index.ts doctor
```

**One thing will feel different:** `leads:qualify` now auto-dedupes against active campaigns + replied leads + your blocklist. Expect ~10-15% fewer leads making it through on re-runs — that's the "don't re-DM people who already replied" rule running automatically. Pass `--no-dedup` if you want old behavior.

**5 new things worth trying this week:**

1. `pipeline:run --file configs/pipelines/find-enrich-qualify.yaml` — whole find → enrich → qualify → export flow as one YAML, no more manual CSV handoffs
2. `research --question "What CRM does X use?" --target x.com` — research agent that returns evidence chains, not just an answer
3. `signals:watch --companies acme.com,globex.com` — get pinged when target companies hire, fund, or make moves
4. `crm:setup --provider hubspot` — push qualified leads straight into HubSpot, skip the CSV step
5. `leads:export --destination lemlist` (or apollo/woodpecker) — sequencer-ready CSV, exact columns

**Also upgraded behind the scenes:**
- 7 providers checked by `doctor` now (was 4)
- Error messages are readable one-liners instead of stack traces
- ~285 new tests added (~485 total)
- MCP provider plugins: plug in HubSpot/Apollo/PDL/ZoomInfo directly

**Full details:** `docs/WHATS-NEW.md`

**If anything breaks:** the previous state is on branch `main-pre-gap-plan-2026-04-22`. `git checkout` it, `pnpm install`, you're back. Then ping me.
