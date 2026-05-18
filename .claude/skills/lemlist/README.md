# Lemlist Claude Code skills (bundled substrate)

The 24 skills in this directory are unmodified copies from [lemlist's open-source Claude Code skill library](https://github.com/l3mpire/claude-skills). They are bundled into YALC so the orchestration skill [`lemlist-campaign-from-icp`](../lemlist-campaign-from-icp/) (sibling directory) can chain them into one end-to-end loop: ICP prompt → paused lemlist campaign in ~5 minutes.

The lemlist MCP server is declared in `.mcp.json` at the repo root (gated by `LEMLIST_API_KEY`).

**Landing page** with the video, the lemlist credit, and the full breakdown: <https://yalc.ai/skills/lemlist-campaign-from-icp/>

## The 24 skills, mapped to the orchestration

| Layer | Lemlist skill | Stage in `lemlist-campaign-from-icp` |
|---|---|---|
| **Strategic foundation** | `icp-definer` | 1 |
| | `persona-definer` | 2, 16 (routing) |
| | `pain-identifier` | 3 |
| | `value-prop-lister` | 4 |
| | `offer-definer` | 5 |
| | `competitor-finder` | 6 |
| | `trigger-finder` | 7 |
| **Sourcing** | `company-finder` | 8 |
| | `list-builder` | 9 |
| | `people-finder` | 10 |
| **Per-lead angle** | `linkedin-outbound-angle` | 13 |
| **Campaign design** | `campaign-angle-finder` | 14 |
| | `outbound-campaign-architect` | 15 |
| **Writing** | `copywriting-vp-sequence` | 17 (if VP+) |
| | `copywriting-manager-sequence` | 17 (if Manager) |
| | `copywriting-ic-sequence` | 17 (if IC) |
| | `copywriting-first-touch` | 18 |
| | `copywriting-follow-up` | 19 |
| | `cta-designer` | 20 |
| **Quality gate** | `copywriting-refiner` | 21 |
| | `copywriting-analyzer` | 22 |
| | `gtm-action-thinker` | 23 |
| **Loop (companion skill)** | `reply-handler` | post-launch reply loop (separate companion orchestration) |
| **Analytics (companion skill)** | `outbound-analyst` | post-launch benchmark (separate companion orchestration) |

24 of lemlist's 38 skills total. The remaining 14 are out of scope for the campaign loop: `n8n-debugger`, `n8n-workflow-builder`, `slide-deck-builder`, `cold-call-script`, `website-scraper`, `crm-duplicate-detector`, `pipeline-analysis`, `persona-insights-analysis`, `claap-sales-opportunity-detector`, `prompt-engineering`, `linkedin-sequence` (2-msg DM only — superseded by full sequences), `market-research-edp`, `deep-company-analyser`, `niche-data-finder`. Install any of them directly from upstream if you need them:

```sh
npx github:l3mpire/claude-skills <skill-name>
```

## Updating from upstream

To pull the latest version of any skill:

```sh
npx github:l3mpire/claude-skills --force --project <skill-name>
```

The `--project` flag writes to `./.claude/skills/`, matching this bundled layout.

## Attribution

All skill files in this directory are © lemlist and distributed under the MIT license as declared in [lemlist's upstream repo README](https://github.com/l3mpire/claude-skills). YALC reproduces them unmodified.

Upstream: <https://github.com/l3mpire/claude-skills>
Marketing page: <https://www.lemlist.com/claude-skills>
Affiliate signup: <https://get.lemlist.com/skrtwnkxw60i>
