# lemlist-campaign-from-icp

> Turn one ICP prompt into a paused live lemlist campaign. In ~5 minutes.

A Yalc orchestration skill built on lemlist's [38-skill Claude Code library](https://www.lemlist.com/claude-skills) + the lemlist MCP server. Chains 24 lemlist atomic skills into one end-to-end loop: ICP → personas → sourcing → agentic enrichment → seniority-routed sequencing → quality gate → paused campaign in lemlist, awaiting your approval.

Landing page with the video, the lemlist credit, and the full breakdown: <https://yalc.ai/skills/lemlist-campaign-from-icp/>

## Install

The skill is bundled with YALC. If you cloned the YALC repo, it's already at `.claude/skills/lemlist-campaign-from-icp/`. To grab just this skill into another project:

```sh
gh repo clone Othmane-Khadri/YALC-the-GTM-operating-system
cp -r YALC-the-GTM-operating-system/.claude/skills/lemlist-campaign-from-icp ./.claude/skills/
cp -r YALC-the-GTM-operating-system/.claude/skills/lemlist ./.claude/skills/
cp YALC-the-GTM-operating-system/.mcp.json .
```

You need the `lemlist/` substrate (24 atomic skills) and the `.mcp.json` (declares the lemlist MCP) alongside the orchestration skill.

## Prerequisites

1. **A lemlist account.** New trial via [our partner link](https://get.lemlist.com/skrtwnkxw60i).
2. **Lemlist MCP connected to Claude Code.** Two options:
   - API key: set `LEMLIST_API_KEY` in your shell environment (generate in lemlist → Settings → Integrations).
   - OAuth: `claude mcp add --transport http lemlist https://app.lemlist.com/mcp`.
   Verify with `/mcp` in Claude Code — you should see lemlist's tools (`create_campaign`, `lemleads_search`, campaign stats, etc.).
3. **Claude Code** installed (the skill is invoked via Claude Code).

## Usage

In Claude Code, in any project that has this skill installed:

```
create a lemlist campaign for VPs of Sales at Series B SaaS companies in Europe
that are hiring Account Executives. Our product helps RevOps teams cut quota
ramp time from 6 months to 3. 50 leads, paused.
```

The skill triggers, walks through the 25-stage chain (visible in chat), and produces a dryrun output at `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`. It then asks for your `approve` before calling MCP `create_campaign`.

After approval, the campaign appears in your lemlist UI in **PAUSED** state — review and start it manually.

## What the chain does (24 lemlist skills + 2 MCP ops)

| Stage | Lemlist skills invoked | MCP ops |
|---|---|---|
| Strategic foundation | `icp-definer`, `persona-definer`, `pain-identifier`, `value-prop-lister`, `offer-definer`, `competitor-finder`, `trigger-finder` | — |
| Sourcing | `company-finder`, `list-builder`, `people-finder` | `lemleads_search` |
| Enrichment | (lemlist Agentic Enrichment runs auto on import) | — |
| Per-lead angle | `linkedin-outbound-angle` | — |
| Campaign design | `campaign-angle-finder`, `outbound-campaign-architect` | — |
| Routing + writing | `copywriting-vp-sequence` / `copywriting-manager-sequence` / `copywriting-ic-sequence`, `copywriting-first-touch`, `copywriting-follow-up`, `cta-designer` | — |
| Quality gate | `copywriting-refiner`, `copywriting-analyzer`, `gtm-action-thinker` | — |
| Approval gate | (Yalc-side dryrun + user `approve`) | — |
| Push | — | `create_campaign` (PAUSED) |

Detailed stage-by-stage breakdown in [SKILL.md](./SKILL.md).

## Safety contract

- PAUSED state hard-coded — never auto-sends.
- Dryrun JSON written before any MCP push.
- Default lead ceiling: 50 (raise with an explicit instruction).
- Explicit `approve` blocks the push.
- No silent retries on MCP errors.

## Cost

- Lemlist credits: ~1 credit per lead sourced via `lemleads_search` + agentic enrichment (check your lemlist plan for current pricing).
- Anthropic API: standard Claude Code token usage for the orchestration (the 25 stages are markdown instructions, no extra API surface).

The skill quotes the estimated credit usage back to you before any sourcing.

## Updating the lemlist atomic skills

The 24 substrate skills under `.claude/skills/lemlist/` are unmodified copies from lemlist's upstream repo. To refresh:

```sh
npx github:l3mpire/claude-skills --force --project <skill-name>
```

See `.claude/skills/lemlist/README.md` for the full procedure.

## Attribution

Built in partnership with lemlist. The 24 atomic skills under `.claude/skills/lemlist/` are © lemlist, MIT (per upstream README). This orchestration skill is open-source under MIT as part of YALC.
