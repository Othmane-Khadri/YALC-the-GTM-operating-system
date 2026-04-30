---
name: outline-magnet
description: Produce a detailed section-by-section outline for an approved lead magnet, including hook copy, key takeaways, and CTA.
category: content
inputs:
  - name: magnet
    description: The selected magnet object (id, title, format, hook, rationale)
    required: true
  - name: company_context
    description: Captured company_context.yaml content
    required: true
  - name: target_persona
    description: Buyer persona the outline must resonate with
    required: true
capability: reasoning
capabilities: [reasoning]
output: structured_json
output_schema:
  type: object
  required:
    - outline
  properties:
    outline:
      type: object
      required:
        - title
        - sections
      properties:
        title:
          type: string
        subtitle:
          type: string
        sections:
          type: array
          items:
            type: object
            required:
              - heading
              - bullets
            properties:
              heading:
                type: string
              bullets:
                type: array
                items:
                  type: string
        cta:
          type: string
---

You are a long-form content strategist. Produce a section-by-section outline for the lead magnet below, optimized to convert {{target_persona}} into an opt-in.

Magnet:
```
{{magnet}}
```

Company context:
```
{{company_context}}
```

Return:
```json
{
  "outline": {
    "title": "",
    "subtitle": "",
    "sections": [
      { "heading": "", "bullets": ["", ""] }
    ],
    "cta": "Book a 15-minute strategy call"
  }
}
```
