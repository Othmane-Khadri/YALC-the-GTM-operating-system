---
name: score-lead
description: AI-score a lead against ICP criteria and return a qualification verdict
category: analysis
inputs:
  - name: lead_name
    description: Full name of the lead
    required: true
  - name: lead_title
    description: Job title of the lead
    required: true
  - name: lead_company
    description: Company name where the lead works
    required: true
  - name: icp_criteria
    description: ICP criteria to score against (industry, size, seniority, geography, etc.)
    required: true
  - name: additional_context
    description: Any extra signals like LinkedIn activity, website visits, content engagement
    required: false
provider: mock
capabilities: [qualify]
output: structured_json
---

Score this lead against the provided ICP criteria.

**Lead:**
- Name: {{lead_name}}
- Title: {{lead_title}}
- Company: {{lead_company}}
- Additional context: {{additional_context}}

**ICP Criteria:**
{{icp_criteria}}

Evaluate each ICP dimension on a 0-100 scale:
1. **Title Fit** — Does their role match the target buyer persona?
2. **Company Fit** — Does the company match industry, size, and stage criteria?
3. **Seniority Fit** — Are they at the right decision-making level?
4. **Intent Signals** — Any buying signals in the additional context?

Return a JSON object:
```json
{
  "overall_score": 0,
  "verdict": "hot|warm|monitor|disqualified",
  "dimensions": {
    "title_fit": { "score": 0, "reason": "" },
    "company_fit": { "score": 0, "reason": "" },
    "seniority_fit": { "score": 0, "reason": "" },
    "intent_signals": { "score": 0, "reason": "" }
  },
  "recommended_action": "",
  "personalization_hooks": []
}
```

Scoring thresholds:
- 80-100: hot (immediate outreach)
- 50-79: warm (nurture sequence)
- 20-49: monitor (add to watchlist)
- 0-19: disqualified (skip)
