# Task Library

Tasks are pre-configured API call definitions. Each YAML file specifies exactly how to call a specific API through Orthogonal (or directly).

## Why Tasks > Dynamic Discovery

Dynamic API discovery (asking Orthogonal to find an API on the fly) works but has two problems:
1. **Unknown parameters** — the system doesn't know what params the API expects
2. **Double cost** — search + run = 2 API calls before any real work

Tasks solve both: they have known parameter mappings and skip the search step.

## How to Add a Task

Create a YAML file in this folder:

```yaml
id: my_custom_task
name: "My Custom Task"
description: "What this task does"
provider: orthogonal          # or "direct" for direct API calls
api_slug: api-name            # Orthogonal API slug
endpoint: /v1/endpoint
method: POST
param_mapping:
  query: api_specific_param   # generic_name: api_param_name
  count: limit
output_fields:
  - company_name: name        # our_field: api_field
  - website: domain
best_for:
  - "When to use this task"
cost_per_call: "~$0.01"
```

## Available Tasks

| Task | Provider | Best For |
|------|----------|----------|
| search_companies_fiber | Fiber AI | European company search |
| search_companies_nyne | Nyne | Detailed company intel + funding |
| enrich_emails_tomba | Tomba | Email discovery by domain |
| enrich_emails_hunter | Hunter | Email patterns + domain search |
| scrape_website_olostep | Olostep | Clean webpage scraping |
