---
name: email-campaign-create
description: Create a cold email campaign in Instantly and start it (sequence + leads attached).
category: outreach
inputs:
  - name: campaign_name
    description: Human-readable campaign name
    required: true
  - name: leads
    description: Array of leads (each with email + optional first_name/last_name/company)
    required: true
  - name: sequence
    description: Array of sequence steps (subject, body, delay_days, variant_label)
    required: true
  - name: account_ids
    description: Optional list of sending mailbox ids
    required: false
capability: email-campaign-create
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
    leadsAdded:
      type: integer
    sequenceLength:
      type: integer
---

Create the Instantly cold-email campaign `{{campaign_name}}` and resume it. Leads come from the provided list; the sequence drips via Instantly's scheduler.
