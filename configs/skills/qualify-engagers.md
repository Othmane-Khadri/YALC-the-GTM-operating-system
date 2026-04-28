---
name: qualify-engagers
description: Score post engagers (commenters/likers) against the user's ICP and return only those above a threshold
category: analysis
inputs:
  - name: engagers
    description: Array of engager profiles (LinkedIn URN, name, headline, company)
    required: true
  - name: min_score
    description: ICP score threshold (0-100). Engagers below this are filtered out.
    required: true
capability: reasoning
capabilities: [qualify]
output: structured_json
output_schema:
  type: array
  items:
    type: object
    required:
      - icp_score
      - role_fit
      - company_fit
      - signal_strength
      - rationale
    properties:
      icp_score:
        type: integer
        minimum: 0
        maximum: 100
      role_fit:
        type: integer
        minimum: 0
        maximum: 40
      company_fit:
        type: integer
        minimum: 0
        maximum: 40
      signal_strength:
        type: integer
        minimum: 0
        maximum: 20
      rationale:
        type: string
---

For each engager, score against the user's captured ICP (read `~/.gtm-os/icp.yaml`). Use:

- **role fit (0-40)** — how close their title is to the target roles.
- **company fit (0-40)** — industry, size, stage match.
- **signal strength (0-20)** — recent role change, hiring, content engagement.

Sum to a total `icp_score` (0-100). Drop any engager with score below {{min_score}}.

Return:
```json
{
  "...original fields": "",
  "icp_score": 0,
  "role_fit": 0,
  "company_fit": 0,
  "signal_strength": 0,
  "rationale": ""
}
```
