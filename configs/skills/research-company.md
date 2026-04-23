---
name: research-company
description: Scrape a company website and extract structured data for outreach prep
category: research
inputs:
  - name: company_url
    description: The company website URL to research
    required: true
  - name: question
    description: Specific question to answer about the company
    required: true
provider: firecrawl
capabilities: [search, enrich]
output: structured_json
---

You are researching {{company_url}} to answer: {{question}}

Scrape the website and extract the following structured information:

1. **Company Overview** — what the company does in one sentence
2. **Key Products/Services** — list their main offerings
3. **Target Market** — who they sell to (industry, company size, persona)
4. **Value Proposition** — their core differentiation
5. **Recent News** — any announcements, blog posts, or press releases from the last 90 days
6. **Tech Stack Signals** — any visible technology choices (frameworks, integrations, platforms)
7. **Team Size Indicators** — hiring pages, team pages, LinkedIn employee count signals

Return a JSON object with these fields:
```json
{
  "company_name": "",
  "website": "",
  "one_liner": "",
  "products": [],
  "target_market": { "industries": [], "company_size": "", "personas": [] },
  "value_proposition": "",
  "recent_news": [],
  "tech_signals": [],
  "team_size_estimate": ""
}
```
