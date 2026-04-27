---
name: classify-replies
description: Categorize inbox replies (interested, objection, not-now, unsubscribe)
category: analysis
inputs:
  - name: replies
    description: Array of reply records
    required: true
  - name: categories
    description: Allowed category labels
    required: true
provider: anthropic
capabilities: [qualify]
output: structured_json
---

For each reply, pick exactly one category from the allowed set: {{categories}}.

Return the array with each row enriched:
```json
{
  "...original fields": "",
  "category": "",
  "confidence": 0,
  "rationale": ""
}
```
