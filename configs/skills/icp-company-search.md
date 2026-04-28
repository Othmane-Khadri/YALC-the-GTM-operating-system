---
name: icp-company-search
description: Run an ICP company search using the user's segments and pain-point hints
category: research
inputs:
  - name: segments
    description: Free-form ICP description (industry, size, geography hints)
    required: true
  - name: pain_points
    description: Pain points to bias the search by
    required: false
capability: icp-company-search
capabilities: [search]
output: structured_json
output_schema:
  type: object
  required:
    - companies
  properties:
    companies:
      type: array
      items:
        type: object
---

Translate the segment description into a structured ICP intent the search adapter understands. The intent shape is `{ industry?, employeeRange?, location?, keywords?, limit? }` — the same shape this capability declares. Do NOT invent provider-specific column or field names; only emit the four optional fields above and let the adapter validate them against the provider's autocomplete catalog.

Bias the search by these pain points if provided: {{pain_points}}.

Run the search and return up to 100 candidate companies in this shape:

```json
[
  { "domain": "", "name": "", "industry": "", "headcount": 0, "country": "", "signal": "" }
]
```
