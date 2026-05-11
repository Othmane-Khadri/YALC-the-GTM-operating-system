---
name: landing-page-deploy
description: Deploy a single-page HTML asset to a hosted URL via Vercel.
category: integration
inputs:
  - name: html
    description: HTML body or full document to publish
    required: true
  - name: slug
    description: URL slug for the published page
    required: false
  - name: title
    description: Document title used by the renderer
    required: false
capability: landing-page-deploy
capabilities: [deploy]
output: structured_json
output_schema:
  type: object
  required:
    - deployed
    - url
  properties:
    deployed:
      type: boolean
    url:
      type: string
    deploymentId:
      type: string
    fallbackReason:
      type: ['string', 'null']
---

Deploy the supplied HTML to a public URL via the Vercel deployment API. Requires `VERCEL_TOKEN`; an optional `VERCEL_TEAM_ID` scopes the deploy to a team. The result returns `{ deployed, url, deploymentId }` — `deployed` is `true` only once Vercel reports `readyState === 'READY'`; on intermediate states the URL is still set so callers can preview or poll.

Slug: {{slug}}
Title: {{title}}
