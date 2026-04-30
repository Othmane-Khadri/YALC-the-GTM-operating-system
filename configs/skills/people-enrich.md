---
name: people-enrich
description: Enrich a list of contacts (firstname/lastname/domain or LinkedIn URL) with email + phone where available.
category: data
inputs:
  - name: contacts
    description: Array of contact records with firstname, lastname, domain, company_name, or linkedin_url
    required: true
capability: people-enrich
capabilities: [enrich]
output: structured_json
output_schema:
  type: object
  required:
    - results
  properties:
    results:
      type: array
      items:
        type: object
---

Enrich the provided contacts (each with firstname/lastname/domain or linkedin_url) using the configured people-enrich provider (FullEnrich first, Crustdata fallback). Return one row per contact with email + phone where available.

Return:
```json
{
  "results": [
    { "firstname": "", "lastname": "", "email": "", "phone": "", "linkedin_url": "" }
  ]
}
```
