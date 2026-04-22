---
name: detect-job-change
description: Detect if a person changed their job title or company since the last baseline check
category: research
version: 1.0.0
provider: crustdata
capabilities: [search]
inputs:
  - name: person_linkedin_url
    description: LinkedIn profile URL of the person to monitor
    required: true
  - name: baseline_title
    description: Last known job title
    required: true
  - name: baseline_company
    description: Last known company name
    required: true
---

Use Crustdata `people_search_db` to look up the person by their LinkedIn URL.

**API call:** `crustdata_people_search_db`
- Filter: `linkedin_profile_url = "{{person_linkedin_url}}"`
- Fields: `current_employers.name`, `current_employers.title`, `headline`
- Limit: 1

**Comparison logic:**
1. Extract the person's current title and company from the response
2. Compare against `baseline_title` = "{{baseline_title}}" and `baseline_company` = "{{baseline_company}}"
3. A signal fires if EITHER:
   - The current company name differs from the baseline company (job change)
   - The current title differs meaningfully from the baseline title (promotion or role change)

**Output format (JSON):**
```json
{
  "changed": true|false,
  "summary": "Jane Doe moved from VP Sales at Acme to CRO at NewCorp",
  "data": {
    "previous_title": "{{baseline_title}}",
    "previous_company": "{{baseline_company}}",
    "current_title": "<from API>",
    "current_company": "<from API>",
    "change_type": "company_change|title_change|both"
  },
  "newBaseline": {
    "title": "<current title>",
    "company": "<current company>"
  }
}
```

**Credit cost:** 3 credits (people_search_db)
