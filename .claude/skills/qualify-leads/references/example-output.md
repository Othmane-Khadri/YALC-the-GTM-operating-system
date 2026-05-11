# qualify-leads — example rendered output

Below is what the user sees after `qualify-leads` runs on a typical 200-row CSV import.

```
Input: /Users/x/leads-2026-04-30.csv (208 rows)

7-gate qualification funnel:
  Loaded                     208
  Gate 0  Dedup              -23 deduped       → 185 survivors
  Gate 1  Pre-qual            -8 missing email → 177 survivors
  Gate 2  Exclusion          -12 blocklist     → 165 survivors
  Gate 3  Company-fit        -34 wrong size    → 131 survivors
  Gate 4  Role-fit           -41 wrong title   →  90 survivors
  Gate 5  ICP scoring        -19 score < 60    →  71 survivors
  Gate 6  Signal enrichment   +0 (skipped)     →  71 survivors

Final: 71 qualified / 137 disqualified

Result set: rs_2026_04_30_a1b2c3d4
  Use this id with `launch-linkedin-campaign` or `personalize-message`.

Top 5 hot leads:
  #1  Sarah Chen        VP Marketing       Acme Corp           score=94
  #2  Diego Alvarez     Head of Growth     Northwind           score=91
  #3  Priya Nair        CMO                Globex              score=88
  #4  Tom Becker        Director, Demand   Initech             score=85
  #5  Lina Costa        Sr Marketing Mgr   Soylent             score=82

Want me to also:
(a) launch a LinkedIn campaign for the 71 qualified leads via `launch-linkedin-campaign`, or
(b) personalize messages for the top N via `personalize-message`?
```

## Failure modes

If the CLI exits non-zero, the skill surfaces the stderr unchanged:

```
leads:qualify failed (exit 1):

Error: ENOENT: no such file or directory, open '/Users/x/leads.csv'
    at Object.openSync (node:fs:599:3)

To fix: confirm the path and re-run.
```

If `--enrich-signals` is set but `PREDICTLEADS_API_KEY` is unset:

```
leads:qualify failed (exit 2):

Error: PREDICTLEADS_API_KEY is not set.

To fix: edit ~/.gtm-os/.env and re-run.
```
