---
name: fetch-inbox-replies
description: Pull recent inbox replies from the cold-email tool
category: research
inputs:
  - name: lookback_hours
    description: How many hours of inbox history to pull
    required: true
capability: inbox-replies-fetch
capabilities: [search]
output: structured_json
output_schema:
  type: object
  required:
    - replies
  properties:
    replies:
      type: array
      items:
        type: object
---

Fetch replies received within the last {{lookback_hours}} hours from the configured email provider.

Return:
```json
[
  { "thread_id": "", "from": "", "received_at": "", "subject": "", "body_excerpt": "" }
]
```
