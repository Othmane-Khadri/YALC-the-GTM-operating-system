---
name: detect-news
description: Detect recent company news and announcements via web scraping
category: research
version: 1.0.0
provider: firecrawl
capabilities: [search]
inputs:
  - name: company_domain
    description: Company website domain to monitor for news
    required: true
  - name: last_check_date
    description: ISO date of the last check (news after this date = new)
    required: true
---

Use Firecrawl to scrape the company's news/blog/press page and extract recent headlines.

**Scraping strategy:**
1. Try these URLs in order (first success wins):
   - `https://{{company_domain}}/blog`
   - `https://{{company_domain}}/news`
   - `https://{{company_domain}}/press`
   - `https://{{company_domain}}/newsroom`
2. Extract: headline text, publication date, URL
3. Filter to items published after `{{last_check_date}}`

**API call:** Firecrawl `scrape_url`
- URL: one of the above
- Extract: article titles, dates, and URLs from the page HTML
- Format: markdown

**Comparison logic:**
1. Parse extracted headlines and dates
2. Filter to items with dates after {{last_check_date}}
3. A signal fires if at least 1 new article is found

**Output format (JSON):**
```json
{
  "changed": true|false,
  "summary": "acme.com published 3 new articles since 2026-03-15",
  "data": {
    "company_domain": "{{company_domain}}",
    "new_articles_count": 3,
    "articles": [
      {
        "title": "Acme Launches AI Platform",
        "date": "2026-03-20",
        "url": "https://acme.com/blog/ai-platform-launch"
      }
    ]
  },
  "newBaseline": {
    "last_check_date": "<today's date>",
    "latest_headline": "<most recent headline>"
  }
}
```

**Credit cost:** 0 Crustdata credits (Firecrawl only)
