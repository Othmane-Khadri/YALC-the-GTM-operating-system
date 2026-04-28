---
name: list-recent-linkedin-posts
description: List the user's most recent LinkedIn posts via Unipile
category: research
inputs:
  - name: account_id
    description: Unipile account id whose LinkedIn posts to list
    required: true
  - name: lookback
    description: Number of recent posts to return
    required: true
capability: linkedin-user-posts-fetch
capabilities: [search]
output: structured_json
---

Use the Unipile API to fetch the user's {{lookback}} most recent posts.

Return:
```json
[
  { "post_id": "", "url": "", "posted_at": "", "text_excerpt": "", "engagement": { "likes": 0, "comments": 0 } }
]
```
