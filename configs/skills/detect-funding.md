---
name: detect-funding
description: Detect new funding rounds for a company by comparing against stored baseline
category: research
version: 1.0.0
provider: crustdata
capabilities: [enrich]
inputs:
  - name: company_domain
    description: Company website domain to monitor for funding events
    required: true
  - name: baseline_funding_total
    description: Last known total funding amount in USD
    required: true
---

Use Crustdata `company_enrich` to check the latest funding data.

**API call:** `crustdata_company_enrich`
- Domain: "{{company_domain}}"
- Fields: `funding_and_investment`
- Prefer cached data (1 credit) over realtime (4 credits)

**Comparison logic:**
1. Extract `total_funding_usd` and latest round details from the response
2. Compare against `baseline_funding_total` = {{baseline_funding_total}}
3. A signal fires if:
   - `total_funding_usd` > baseline (new funding detected)
   - OR a new round appears that wasn't in the baseline

**Output format (JSON):**
```json
{
  "changed": true|false,
  "summary": "acme.com raised a Series B: $25M (total funding now $38M)",
  "data": {
    "company_domain": "{{company_domain}}",
    "previous_total": {{baseline_funding_total}},
    "current_total": "<from API>",
    "delta": "<current - baseline>",
    "latest_round": {
      "type": "Series B",
      "amount": 25000000,
      "date": "2026-03-15",
      "investors": ["Sequoia", "a16z"]
    }
  },
  "newBaseline": {
    "funding_total": "<current total>",
    "last_round_date": "<date of latest round>"
  }
}
```

**Credit cost:** 1 credit (company_enrich cached)
