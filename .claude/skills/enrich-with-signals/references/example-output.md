# enrich-with-signals — example rendered output

```
Result set: rs_2026_04_30_a1b2c3d4 (71 qualified companies)
Signal types: jobs, funding, tech, news

Enrichment complete:
  Cache hits:  43 / 71 companies (no API call)
  Fresh pulls: 28 / 71 companies (PredictLeads, ~28 credits)

Signals found:
  jobs:        61 companies have ≥1 open role
  funding:     14 raised in last 12 months
  tech:        67 have a detected stack signal (Segment, Snowflake, etc.)
  news:        38 have ≥1 press mention in last 90 days
  leadership:  12 had a senior hire in last 60 days

Top signal-rich accounts:
  acmecorp.com       jobs:8 funding:$50M news:5 tech:Segment
  globex.com         jobs:5 leadership:CMO news:3
  initech.com        jobs:12 tech:Snowflake news:2

Result set updated: rs_2026_04_30_a1b2c3d4 (signals_enriched)

Want me to:
  (a) qualify with score uplift via `qualify-leads --result-set rs_2026_04_30_a1b2c3d4`?
  (b) segment a campaign by signal type?
```
