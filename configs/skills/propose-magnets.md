---
name: propose-magnets
description: Propose 5 lead-magnet ideas tailored to the company's ICP and positioning, ranked by attractiveness.
category: content
inputs:
  - name: company_context
    description: Captured company_context.yaml content (positioning, ICP, voice notes)
    required: true
  - name: target_persona
    description: Specific buyer persona the magnet should resonate with (e.g. "VP RevOps at Series B SaaS")
    required: true
capability: reasoning
capabilities: [reasoning]
output: structured_json
output_schema:
  type: object
  required:
    - magnets
  properties:
    magnets:
      type: array
      minItems: 1
      items:
        type: object
        required:
          - id
          - title
          - format
          - hook
        properties:
          id:
            type: string
          title:
            type: string
          format:
            type: string
          hook:
            type: string
          attractiveness:
            type: number
          rationale:
            type: string
---

You are a B2B demand-gen strategist. Read the company context and target persona, then propose **5 distinct lead-magnet ideas** tailored to that persona. Each should differ on format (e.g. checklist, calculator, swipe-file, mini-course, benchmark report).

Score each idea 0..10 on `attractiveness` (likelihood the persona will trade an email for it).

Company context:
```
{{company_context}}
```

Target persona: {{target_persona}}

Return:
```json
{
  "magnets": [
    { "id": "m1", "title": "", "format": "", "hook": "", "attractiveness": 0, "rationale": "" }
  ]
}
```
