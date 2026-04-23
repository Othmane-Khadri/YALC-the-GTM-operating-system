---
name: enrich-email
description: Find a professional email address given a person name and company
category: data
inputs:
  - name: first_name
    description: Person's first name
    required: true
  - name: last_name
    description: Person's last name
    required: true
  - name: company_domain
    description: Company website domain (e.g. acme.com)
    required: true
provider: fullenrich
capabilities: [enrich]
output: structured_json
---

Find the professional email address for {{first_name}} {{last_name}} who works at {{company_domain}}.

Search strategy:
1. Check common email patterns: first.last@domain, first@domain, flast@domain, firstl@domain
2. Cross-reference with any public records, professional directories, or verified databases
3. Validate deliverability if possible

Return a JSON object:
```json
{
  "email": "",
  "confidence": "high|medium|low",
  "pattern": "",
  "verified": true,
  "source": ""
}
```

If no email can be found with reasonable confidence, return:
```json
{
  "email": null,
  "confidence": "none",
  "pattern": null,
  "verified": false,
  "source": "no match found"
}
```
