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
capability: reasoning
capabilities: [qualify]
output: structured_json
output_schema:
  type: array
  items:
    type: object
    required:
      - category
      - confidence
      - rationale
    properties:
      category:
        type: string
      confidence:
        type: number
        minimum: 0
        maximum: 1
      rationale:
        type: string
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
