---
name: linkedin-trending-content
description: Search LinkedIn for high-engagement posts on a niche keyword (likes+comments above threshold).
category: research
inputs:
  - name: account_id
    description: Unipile account id used for search
    required: true
  - name: keyword
    description: Free-text search query
    required: true
  - name: min_engagement
    description: Minimum likes+comments to consider a post trending (default 50)
    required: false
  - name: limit
    description: Max posts to fetch (default 25)
    required: false
capability: linkedin-trending-content
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
    keyword:
      type: string
    minEngagement:
      type: integer
    limit:
      type: integer
    accountId:
      type: string
---

Search LinkedIn for posts matching `{{keyword}}` via Unipile (account `{{account_id}}`). Filter to posts with `likes + comments >= {{min_engagement}}`, return top `{{limit}}` sorted by total engagement.

Return:
```json
{
  "posts": [
    { "post_id": "", "url": "", "text_excerpt": "", "engagement": { "likes": 0, "comments": 0, "total": 0 } }
  ]
}
```
