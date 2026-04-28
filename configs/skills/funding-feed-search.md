---
name: funding-feed-search
description: Search the funding feed for companies that announced a round in the recent window matching ICP segments
category: research
version: 1.0.0
capability: funding-feed
inputs:
  - name: segments
    description: ICP segments to filter the feed by (industry, size, geography hints)
    required: true
  - name: min_round_size_usd
    description: Skip rounds smaller than this dollar amount
    required: false
  - name: window
    description: Lookback window like "24h", "7d", "14d", or "30d"
    required: false
output_schema:
  type: object
  required: [companies]
  properties:
    companies:
      type: array
      items:
        type: object
        required: [domain, name, round_type, round_size_usd, announced_at]
        properties:
          domain: { type: string }
          name: { type: string }
          round_type: { type: string }
          round_size_usd: { type: number }
          lead_investor: { type: string }
          announced_at: { type: string }
          rationale: { type: string }
        additionalProperties: false
  additionalProperties: false
---

Run a funding-feed search for companies that announced a round in the {{window}} window matching segments: {{segments}}.

Skip rounds smaller than {{min_round_size_usd}} USD.

Return the list of recently-funded companies suitable for outbound outreach. The funding-feed adapter performs the underlying provider call — this skill declares the segment-shaped intent and maps to the capability registry.
