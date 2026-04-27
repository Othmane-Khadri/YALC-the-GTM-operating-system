---
name: crustdata-icp-search
description: Run a Crustdata company search using the user's ICP segments
category: research
inputs:
  - name: segments
    description: Free-form ICP description (industry, size, geography hints)
    required: true
  - name: pain_points
    description: Pain points to bias the search by
    required: false
provider: crustdata
capabilities: [search]
output: structured_json
---

Translate the segment description into Crustdata company filters (industry, headcount, location, growth signals). Run the search and return up to 100 candidate companies:

```json
[
  { "domain": "", "name": "", "industry": "", "headcount": 0, "country": "", "signal": "" }
]
```

Bias the search by these pain points if provided: {{pain_points}}.
