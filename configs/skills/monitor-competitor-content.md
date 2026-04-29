---
name: monitor-competitor-content
description: Fetch the most recent posts published by a tracked competitor on LinkedIn and surface their angles + engagement.
category: research
inputs:
  - name: account_id
    description: Unipile account id used to make the request
    required: true
  - name: competitor_url
    description: LinkedIn URL of the competitor profile or company page
    required: true
  - name: limit
    description: Maximum number of recent posts to return (default 10)
    required: false
capability: linkedin-content-fetch
capabilities: [search]
output: structured_json
output_schema:
  type: object
  required:
    - posts
  properties:
    posts:
      type: array
      items:
        type: object
    accountId:
      type: string
    competitorUrl:
      type: ['string', 'null']
    userId:
      type: string
    limit:
      type: integer
---

Pull the {{limit}} most recent LinkedIn posts authored by {{competitor_url}} via Unipile (account {{account_id}}).

Return:
```json
[
  { "post_id": "", "url": "", "posted_at": "", "text_excerpt": "", "engagement": { "likes": 0, "comments": 0 }, "angle": "" }
]
```
