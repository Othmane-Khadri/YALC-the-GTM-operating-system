---
name: rank-and-truncate
description: Sort an array of mentions by relevance score and return only the top N
category: analysis
inputs:
  - name: mentions
    description: Array of mentions, each containing a `relevance_score` field
    required: true
  - name: n
    description: Maximum number of rows to return
    required: true
provider: deterministic
capabilities: [filter]
output: structured_json
# Pass-through skill: returns the top-N input rows unchanged. The output
# shape mirrors the caller's input, so it cannot be described statically.
# Set to null to opt out of runtime schema validation.
output_schema: null
---

Sort `mentions` by `relevance_score` descending (ties broken by `score` or `num_comments` if present, then by recency). Return the top {{n}} rows unchanged. No new fields.
