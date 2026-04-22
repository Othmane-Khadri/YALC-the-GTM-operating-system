---
name: detect-hiring-surge
description: Detect if a company has a significant increase in open job postings
category: research
version: 1.0.0
provider: crustdata
capabilities: [search]
inputs:
  - name: company_domain
    description: Company website domain to monitor for hiring surges
    required: true
  - name: baseline_job_count
    description: Last known number of open positions
    required: true
  - name: threshold
    description: Minimum new jobs above baseline to trigger a signal (default 5)
    required: false
---

Use Crustdata `job_search` to count current open positions for the company.

**API call:** `crustdata_job_search`
- Filter: `company_domain = "{{company_domain}}"`
- Aggregation: count by company
- Limit: 1 (we only need the count)

**Comparison logic:**
1. Get the total count of current open positions
2. Compare against `baseline_job_count` = {{baseline_job_count}}
3. Compute delta = current_count - baseline
4. A signal fires if delta >= threshold (default: {{threshold}} or 5)

**Output format (JSON):**
```json
{
  "changed": true|false,
  "summary": "acme.com is hiring: 23 open positions (+15 since last check)",
  "data": {
    "company_domain": "{{company_domain}}",
    "current_job_count": "<from API>",
    "baseline_job_count": {{baseline_job_count}},
    "delta": "<current - baseline>",
    "top_roles": ["<title 1>", "<title 2>", "<title 3>"]
  },
  "newBaseline": {
    "job_count": "<current count>"
  }
}
```

**Credit cost:** 1 credit (job_search)
