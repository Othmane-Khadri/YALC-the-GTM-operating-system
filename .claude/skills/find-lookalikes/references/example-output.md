# find-lookalikes — example rendered output

```
Seed: acmecorp.com

Lookalikes (PredictLeads similar_companies, 24 results):
  globex.com               headcount: 120  match_score: 0.91
  initech.com              headcount:  88  match_score: 0.87
  soylentcorp.com          headcount: 145  match_score: 0.84
  ... (21 more)

Result set: rs_2026_04_30_lookalikes_acme_x9y8

Cache: miss → fetched fresh from PredictLeads (1 credit consumed)

Want me to:
  (a) enrich these with signals via `enrich-with-signals`?
  (b) qualify them via `qualify-leads --result-set rs_2026_04_30_lookalikes_acme_x9y8`?
```

## Failure modes

```
signals:similar failed (exit 1):
Error: PREDICTLEADS_API_KEY is not set.
To fix: edit ~/.gtm-os/.env and re-run.
```
