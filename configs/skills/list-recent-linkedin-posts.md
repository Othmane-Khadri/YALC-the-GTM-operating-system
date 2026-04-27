---
name: list-recent-linkedin-posts
description: List the user's most recent LinkedIn posts via Unipile
category: research
inputs:
  - name: lookback
    description: Number of recent posts to return
    required: true
provider: unipile
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
