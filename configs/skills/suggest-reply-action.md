---
name: suggest-reply-action
description: Suggest a next action and a draft reply for each classified inbound message
category: outreach
inputs:
  - name: replies
    description: Array of classified reply records (with `category` field)
    required: true
provider: anthropic
capabilities: [custom]
output: structured_json
---

For each reply, suggest:

- **next_action** — book-call | answer-objection | nurture | mark-unsubscribed | no-action.
- **draft_reply** — a short message (under 600 characters) that the user can send as-is. Match the user's voice (read `~/.gtm-os/voice.md`). Never invent product capabilities — stick to what's in the captured context.

Return the array with each row enriched:
```json
{
  "...original fields": "",
  "next_action": "",
  "draft_reply": ""
}
```
