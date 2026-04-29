---
name: propose-campaigns
description: Propose 3 distinct outreach campaign variants (angle, ICP target, channel, hook) for the operator to pick from.
category: outreach
inputs:
  - name: company_context
    description: Captured company_context.yaml content (positioning, ICP, voice notes)
    required: true
  - name: hypothesis
    description: One-line hypothesis the operator wants to test (e.g. "Series A SaaS CTOs care about LLM compliance")
    required: true
  - name: channel
    description: Preferred channel — "linkedin" or "email" (default "linkedin")
    required: false
capability: reasoning
capabilities: [reasoning]
output: structured_json
output_schema:
  type: object
  required:
    - variants
  properties:
    variants:
      type: array
      minItems: 1
      items:
        type: object
        required:
          - id
          - angle
          - target_persona
          - channel
          - hook
        properties:
          id:
            type: string
          angle:
            type: string
          target_persona:
            type: string
          channel:
            type: string
          hook:
            type: string
          rationale:
            type: string
---

You are an outreach strategist. Read the company context below and the operator's hypothesis, then propose **3 distinct campaign variants** that would let the operator test it cleanly. Each variant must differ on at least one dimension: angle, target persona, or hook framing.

Company context:
```
{{company_context}}
```

Hypothesis: {{hypothesis}}
Channel: {{channel}}

Return structured JSON:
```json
{
  "variants": [
    { "id": "v1", "angle": "", "target_persona": "", "channel": "linkedin", "hook": "", "rationale": "" }
  ]
}
```
