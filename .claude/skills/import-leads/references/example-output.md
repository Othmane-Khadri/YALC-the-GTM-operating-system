# import-leads — example rendered output

```
Source: csv
Input:  /Users/x/leads-2026-04-30.csv

Imported 208 rows into local SQLite.
  Email coverage:     201 / 208
  LinkedIn coverage:  187 / 208
  Custom fields:      4 detected (segment, lifecycle_stage, account_owner, source)

Result set: rs_2026_04_30_import_a1b2

Want me to:
  (a) qualify these via `qualify-leads --result-set rs_2026_04_30_import_a1b2`?
  (b) launch a campaign on this set via `launch-linkedin-campaign`?
```
