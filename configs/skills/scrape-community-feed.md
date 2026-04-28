---
name: scrape-community-feed
description: Fetch high-engagement posts from target communities matching keywords
category: research
inputs:
  - name: communities
    description: Comma-separated community identifiers (subreddits, slugs)
    required: true
  - name: keywords
    description: Keywords / pain points to weight relevance on
    required: true
  - name: min_upvotes
    description: Skip posts below this engagement threshold
    required: true
capability: web-fetch
capabilities: [search]
output: structured_json
---

For each community in {{communities}}, fetch posts in the past 7 days that mention any of the keywords {{keywords}} and have at least {{min_upvotes}} upvotes.

Return:
```json
[
  { "community": "", "title": "", "url": "", "score": 0, "num_comments": 0, "snippet": "", "matched_keywords": [] }
]
```
