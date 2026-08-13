---
name: fetch-inbox-replies
description: Read one campaign-scoped inbox page from the cold-email tool
category: research
inputs:
  - name: campaign_id
    description: Exact provider campaign ID to read
    required: true
  - name: cursor
    description: Cursor from the previous result's nextCursor, if any
    required: false
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

Fetch one page of messages for the exact campaign {{campaign_id}} from the
configured email provider. Do not follow `nextCursor` automatically.

Return:
```json
[
  { "externalThreadId": "", "email": "", "providerTimestamp": "", "subject": "", "bodyText": "" }
]
```
