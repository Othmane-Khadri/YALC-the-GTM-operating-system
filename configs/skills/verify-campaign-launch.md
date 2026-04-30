---
name: verify-campaign-launch
description: Final sanity-check pass before pulling the trigger on a campaign. Looks for missing leads, duplicate sequences, wrong-channel mismatches.
category: outreach
inputs:
  - name: campaign_payload
    description: Full draft campaign object (variants + leads + sequence + schedule)
    required: true
capability: reasoning
capabilities: [reasoning]
output: structured_json
output_schema:
  type: object
  required:
    - ready
    - issues
  properties:
    ready:
      type: boolean
    issues:
      type: array
      items:
        type: object
        required:
          - severity
          - message
        properties:
          severity:
            type: string
          message:
            type: string
    summary:
      type: string
---

You are a release-gate reviewer. The operator is about to launch the campaign described below. Audit it for:

1. Missing or empty leads list.
2. Sequence steps with empty bodies or impossible delays (negative, or DM2 before DM1).
3. Subject lines on LinkedIn DMs (LinkedIn doesn't have subjects).
4. Personalization tokens (e.g. `{firstname}`) left unfilled where personalization is expected.
5. Schedule timezone mismatch with operator timezone (warn only).

Campaign payload:
```
{{campaign_payload}}
```

Return:
```json
{
  "ready": false,
  "issues": [
    { "severity": "error", "message": "" }
  ],
  "summary": "Two-line summary the operator can read at a glance."
}
```
