---
name: crustdata-funding-feed
description: Fetch companies that announced funding within a time window
category: research
inputs:
  - name: segments
    description: ICP segments to filter the funding feed by
    required: true
  - name: min_round_size_usd
    description: Skip rounds smaller than this
    required: true
  - name: window
    description: Time window (e.g. "24h", "7d")
    required: true
provider: crustdata
capabilities: [search]
output: structured_json
---

Fetch the Crustdata funding feed restricted to {{window}} and segments {{segments}}.
Filter rounds below {{min_round_size_usd}} USD.

Return:
```json
[
  { "domain": "", "name": "", "round_type": "", "round_size_usd": 0, "lead_investor": "", "announced_at": "", "rationale": "" }
]
```
