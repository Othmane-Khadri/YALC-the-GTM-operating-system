---
name: scrape-post-engagers
description: Fetch likers and commenters of a list of LinkedIn posts via Unipile
category: research
inputs:
  - name: posts
    description: Array of post records (each with `post_id`)
    required: true
provider: unipile
capabilities: [search, enrich]
output: structured_json
---

For each post in `posts`, fetch likers and commenters via Unipile.
Dedupe across posts (same person engaging multiple posts → one row).

Return:
```json
[
  { "name": "", "headline": "", "company": "", "linkedin_url": "", "engaged_posts": ["post_id_1"], "engagement_type": "comment|like" }
]
```
