---
name: linkedin-campaign-create
description: Create a LinkedIn outreach campaign and start the first sequence step (connection or DM) for every lead.
category: outreach
inputs:
  - name: account_id
    description: Unipile account id sending the campaign
    required: true
  - name: campaign_name
    description: Human-readable campaign name
    required: true
  - name: leads
    description: Array of leads (each with provider_id and optional message)
    required: true
  - name: sequence
    description: Array of sequence steps (kind=connection|dm, body, delay_days)
    required: true
capability: linkedin-campaign-create
capabilities: [outreach]
output: structured_json
output_schema:
  type: object
  required:
    - campaignId
    - status
  properties:
    campaignId:
      type: string
    status:
      type: string
    leadsAttempted:
      type: integer
    leadsSucceeded:
      type: integer
    failures:
      type: array
      items:
        type: object
    sequenceLength:
      type: integer
    accountId:
      type: string
---

Create the LinkedIn campaign `{{campaign_name}}` on Unipile account `{{account_id}}` with the supplied `leads` and `sequence`. The first sequence step (connection or DM) is fired immediately for every lead. Subsequent DMs are scheduled by the `campaign:track` runner.
