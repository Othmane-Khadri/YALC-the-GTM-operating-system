---
name: suggest-reply-action
description: Suggest a next action and a draft reply for each classified inbound message
category: outreach
inputs:
  - name: replies
    description: Array of classified reply records (with `category` field)
    required: true
  - name: voice_md_content
    description: Captured tone-of-voice markdown (do/don't list, signature phrases). Injected by the framework runner from the user's `voice/tone-of-voice.md`; never read from disk by the prompt itself.
    required: true
capability: reasoning
capabilities: [custom]
output: structured_json
output_schema:
  type: array
  items:
    type: object
    required:
      - next_action
      - draft_reply
    properties:
      next_action:
        type: string
        enum:
          - book-call
          - answer-objection
          - nurture
          - mark-unsubscribed
          - no-action
      draft_reply:
        type: string
        maxLength: 600
---

For each reply, suggest:

- **next_action** — book-call | answer-objection | nurture | mark-unsubscribed | no-action.
- **draft_reply** — a short message (under 600 characters) that the user can send as-is. Match the user's voice using the captured tone-of-voice below. Never invent product capabilities — stick to what's in the captured context.

**Captured tone-of-voice (from the user's `voice/tone-of-voice.md`):**

```markdown
{{voice_md_content}}
```

If `voice_md_content` is empty, fall back to a neutral, professional tone — never invent voice rules.

Return the array with each row enriched:
```json
{
  "...original fields": "",
  "next_action": "",
  "draft_reply": ""
}
```
