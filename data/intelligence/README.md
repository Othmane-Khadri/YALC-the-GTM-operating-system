# Intelligence System — Schema Reference

Intelligence entries are JSON files that accumulate learnings across GTM-OS sessions. They are the system's long-term memory.

## JSON Schema

```json
{
  "id": "unique-id",
  "category": "icp|channel|content|timing|provider|qualification|campaign|competitive",
  "insight": "The specific, actionable learning",
  "evidence": [
    {
      "date": "2026-03-12",
      "source": "search_fiber",
      "detail": "25/25 results had valid domains"
    }
  ],
  "confidence": "hypothesis|validated|proven",
  "confidence_score": 0,
  "segment": "primary|null",
  "date_created": "2026-03-12",
  "date_updated": "2026-03-12",
  "supersedes": "old-id|null"
}
```

## Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique identifier (format: `{category}_{topic}_{date}`) |
| `category` | enum | yes | One of: icp, channel, content, timing, provider, qualification, campaign, competitive |
| `insight` | string | yes | The specific, actionable learning in plain language |
| `evidence` | array | yes | Supporting data points (at least 1) |
| `evidence[].date` | string | yes | ISO date when evidence was observed |
| `evidence[].source` | string | yes | What operation produced this evidence |
| `evidence[].detail` | string | yes | Specific observation or measurement |
| `confidence` | enum | yes | hypothesis, validated, or proven |
| `confidence_score` | number | yes | 0-100 numeric confidence |
| `segment` | string | no | Which ICP segment this applies to (null = all) |
| `date_created` | string | yes | ISO date of first creation |
| `date_updated` | string | yes | ISO date of last update |
| `supersedes` | string | no | ID of an older entry this replaces |

## Confidence Lifecycle

- **Hypothesis** (score 10-30) — Single observation from one operation. Do not use in prompts.
- **Validated** (score 40-70) — 2+ independent evidence points confirm the pattern. Safe to use in qualification and content generation.
- **Proven** (score 80-100) — 30+ data points across 14+ days with no contradictions. High-confidence, weight heavily in all operations.

## File Naming

`data/intelligence/{category}_{topic}_{YYYYMMDD}.json`

Examples:
- `provider_fiber_european_20260312.json`
- `icp_french_saas_20260312.json`
- `campaign_dach_linkedin_20260315.json`

## Categories

| Category | What it captures | Example insight |
|----------|-----------------|-----------------|
| icp | ICP fit patterns | "French SaaS companies score 22% higher on ICP fit" |
| channel | Channel effectiveness | "Reddit produces 3x more qualified replies than LinkedIn" |
| content | Content performance | "Subject lines with questions get 2x open rates" |
| timing | Timing patterns | "Tuesday morning sends outperform Friday afternoon by 40%" |
| provider | Provider quality | "Fiber AI returns better data for EU companies than Nyne" |
| qualification | Scoring patterns | "Companies with 100-300 employees convert at 4x the rate" |
| campaign | Campaign outcomes | "DACH LinkedIn outreach hypothesis confirmed: 2.1x conversion" |
| competitive | Competitor intelligence | "Apollo users churning — data quality declining since Q3" |
