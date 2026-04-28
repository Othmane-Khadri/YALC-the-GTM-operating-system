---
name: scrape-reddit-keyword
description: Scrape Reddit posts mentioning specific keywords across one or more subreddits within a time window
category: research
inputs:
  - name: keywords
    description: Comma-separated keywords to match (case-insensitive across title and body)
    required: true
  - name: subreddits
    description: Comma-separated subreddit names (no /r/ prefix)
    required: true
  - name: since
    description: Lower-bound time window (relative phrase like "yesterday-08:00" or "7-days-ago")
    required: true
capability: web-fetch
capabilities: [search]
output: structured_json
---

You are scraping Reddit for posts that mention any of these keywords: {{keywords}}.

Search across these subreddits: {{subreddits}}.
Restrict to posts created since: {{since}}.

For each matching post return a JSON row:
```json
{
  "subreddit": "",
  "title": "",
  "url": "",
  "author": "",
  "created_utc": "",
  "score": 0,
  "num_comments": 0,
  "matched_keywords": [],
  "snippet": ""
}
```

Output a JSON array of rows. Skip stickied/moderator posts. Cap output at 200 rows total — the next step ranks and truncates further.
