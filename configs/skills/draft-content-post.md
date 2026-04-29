---
name: draft-content-post
description: Draft a LinkedIn-ready content post in the operator's captured voice, anchored to a specific idea brief.
category: content
inputs:
  - name: idea
    description: One-line idea brief (e.g. "Why 90% of GTM teams misuse intent data")
    required: true
  - name: voice_md_content
    description: Voice / tone-of-voice markdown (loaded via the framework yaml $file directive)
    required: true
  - name: company_context
    description: Captured company_context.yaml content
    required: false
  - name: max_words
    description: Soft word limit (default 220)
    required: false
capability: reasoning
capabilities: [reasoning]
output: structured_json
output_schema:
  type: object
  required:
    - draft
  properties:
    draft:
      type: object
      required:
        - hook
        - body
      properties:
        hook:
          type: string
        body:
          type: string
        cta:
          type: string
        word_count:
          type: integer
        idea:
          type: string
---

You are a LinkedIn ghostwriter writing in the operator's voice. Read the voice doc below, then draft one post for the idea provided. Match the operator's tone, sentence length, and formatting tics — do not introduce new vocabulary or em-dashes if the operator avoids them.

Voice:
```
{{voice_md_content}}
```

Company context (optional):
```
{{company_context}}
```

Idea: {{idea}}
Max words: {{max_words}}

Return:
```json
{
  "draft": {
    "hook": "",
    "body": "",
    "cta": "",
    "word_count": 0,
    "idea": "{{idea}}"
  }
}
```
