---
name: generate-magnet-asset
description: Render an approved lead-magnet outline into a downloadable HTML asset (with optional PDF/PNG via Playwright).
category: content
inputs:
  - name: outline_html
    description: Pre-rendered HTML body of the magnet (from outline-magnet + a templater step)
    required: true
  - name: filename
    description: Output filename stem (no extension; defaults to "lead-magnet")
    required: false
  - name: format
    description: Output format — "html" (default), "pdf", or "png"
    required: false
  - name: title
    description: Document title used by the renderer
    required: false
capability: asset-rendering
capabilities: [render]
output: structured_json
output_schema:
  type: object
  required:
    - rendered
    - path
    - format
  properties:
    rendered:
      type: boolean
    path:
      type: string
    format:
      type: string
    fallbackReason:
      type: ['string', 'null']
---

Render the lead-magnet HTML below into the requested format using the asset-rendering capability. When the format is `pdf` or `png`, the runtime will use Playwright if it's installed; otherwise it falls back to writing the HTML and returns a `fallbackReason` explaining how to install Playwright.

Title: {{title}}
Filename: {{filename}}
Format: {{format}}

HTML:
```
{{outline_html}}
```

Return the structured JSON the asset-rendering capability produces.
