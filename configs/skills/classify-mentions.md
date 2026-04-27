---
name: classify-mentions
description: Classify a list of mentions or posts by relevance and sentiment using an LLM
category: analysis
inputs:
  - name: mentions
    description: Array of mention/post objects from a previous step
    required: true
  - name: relevance_prompt
    description: One-line description of what makes a mention "relevant" for this framework
    required: true
provider: anthropic
capabilities: [filter, qualify]
output: structured_json
---

For each mention in `mentions`, decide:

1. **Relevance score (0-100)** — apply the rule: {{relevance_prompt}}
2. **Sentiment** — one of: positive, neutral, negative, mixed.
3. **One-line classification rationale** — why you scored it that way.

Return the same array, with each row enriched with new fields:
```json
{
  "...original fields": "",
  "relevance_score": 0,
  "sentiment": "neutral",
  "rationale": ""
}
```

Be strict — name-drops without context score below 30. Real evaluations / comparisons score 70+.
