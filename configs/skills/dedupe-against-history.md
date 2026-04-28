---
name: dedupe-against-history
description: Drop candidates that have appeared in prior runs of the same framework
category: analysis
inputs:
  - name: candidates
    description: Array of candidate rows (each with a `domain` or stable id)
    required: true
  - name: lookback_days
    description: How many days back of run history to dedupe against
    required: true
provider: deterministic
capabilities: [filter]
output: structured_json
# Pass-through skill: returns a subset of the input rows unchanged. The
# output shape is whatever the caller passed in, so it cannot be described
# statically. Set to null to opt out of runtime schema validation.
output_schema: null
---

Read the framework's runs from `~/.gtm-os/agents/<framework>.runs/` covering the past {{lookback_days}} days. Build a set of seen ids (domain, post_id, or canonical url). Drop any candidate already in that set.

Return the surviving rows, preserving order.
