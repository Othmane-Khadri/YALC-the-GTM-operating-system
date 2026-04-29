---
name: landing-page-deploy
description: Deploy a single-page HTML asset to a hosted URL (vercel-mcp when configured; local file fallback otherwise).
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
    fallbackReason:
      type: ['string', 'null']
---

Deploy the supplied HTML to a public URL via the configured deployer (vercel-mcp). Falls back to a local file when no deployer is configured — the returned `fallbackReason` explains how to install vercel-mcp to enable real deploys.

Slug: {{slug}}
Title: {{title}}
