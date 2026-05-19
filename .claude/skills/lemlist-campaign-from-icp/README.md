# lemlist-campaign-from-icp

> Turn one ICP prompt into a paused live lemlist campaign. In ~5 minutes.

A Yalc orchestration skill built on lemlist's [38-skill Claude Code library](https://www.lemlist.com/claude-skills) + the lemlist MCP server. Chains 24 lemlist atomic skills into one end-to-end loop: ICP → personas → sourcing → agentic enrichment → seniority-routed sequencing → quality gate → paused campaign in lemlist, awaiting your approval.

Landing page with the video, the lemlist credit, and the full breakdown: <https://yalc.ai/skills/lemlist-campaign-from-icp/>

## Install

### Prerequisites

- **Node.js 18+** (the lemlist MCP runs via `npx mcp-remote`)
- **Claude Code** installed
- **A lemlist account** ([trial via partner link](https://get.lemlist.com/skrtwnkxw60i))
- **`LEMLIST_API_KEY` exported in your shell BEFORE starting Claude Code** (generate in lemlist → Settings → Integrations). The env var is consumed when the MCP process boots, not on each request. Restart Claude Code after exporting.
- **At least one email sender connected in your lemlist account.** lemlist → Settings → Senders. Without a connected sender, `validate_campaign_readiness` returns `has_errors: "No senders configured"` and the campaign cannot launch even after manual review. The orchestrator surfaces this error at stage 25e but cannot resolve it for you.

### Copy the skill into your project

```sh
gh repo clone Othmane-Khadri/YALC-the-GTM-operating-system /tmp/yalc-src
cp -r /tmp/yalc-src/.claude/skills/lemlist-campaign-from-icp ./.claude/skills/
cp -r /tmp/yalc-src/.claude/skills/lemlist ./.claude/skills/
```

You need BOTH directories: the orchestrator (`lemlist-campaign-from-icp/`) and the 24-skill substrate (`lemlist/`). The orchestrator fails fast if the substrate is missing.

### Wire the lemlist MCP server

If your project does NOT already have a `.mcp.json`:

```sh
cp /tmp/yalc-src/.mcp.json .
```

If your project ALREADY has a `.mcp.json`, MERGE the lemlist entry into your existing `mcpServers` object (do not overwrite):

```json
{
  "mcpServers": {
    "lemlist": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://app.lemlist.com/mcp",
        "--header",
        "X-API-Key: ${LEMLIST_API_KEY}"
      ]
    }
  }
}
```

Restart Claude Code. Verify with `/mcp` — you should see lemlist tools including `get_lemleads_filters`, `lemleads_search`, `create_campaign_with_sequence`, `add_sequence_step`, `add_lead_to_campaign`, `validate_campaign_readiness`, `set_campaign_state`.

### Alternative: interactive OAuth

If you prefer not to manage an API key, you can connect via OAuth: `claude mcp add --transport http lemlist https://app.lemlist.com/mcp`. This works for interactive sessions but does not survive in headless/CI contexts. Tool surface is otherwise identical.

## Usage

In Claude Code, in any project that has this skill installed:

```
create a lemlist campaign for VPs of Sales at Series B SaaS companies in Europe
that are hiring Account Executives. Our product helps RevOps teams cut quota
ramp time from 6 months to 3. 50 leads, paused.
```

The skill triggers, walks through the 25-stage chain (visible in chat), and produces a dryrun output at `~/.gtm-os/lemlist-campaign-from-icp/dryrun-{timestamp}.json`. It then asks for your `approve` before calling any campaign-creation or lead-add MCP tool.

After approval, the campaign appears in your lemlist UI in **DRAFT** state — review and start it manually. The orchestrator never calls `set_campaign_state` with action `start`.

## What the chain does (24 lemlist skills + 6 MCP ops)

| Stage | Lemlist skills invoked | MCP ops |
|---|---|---|
| Strategic foundation | `icp-definer`, `persona-definer`, `pain-identifier`, `value-prop-lister`, `offer-definer`, `competitor-finder`, `trigger-finder` | — |
| Sourcing | `company-finder`, `list-builder`, `people-finder` | `get_lemleads_filters`, `lemleads_search` |
| Enrichment | (server-side platform enrichment, no flags enabled by default) | — |
| Per-lead angle | `linkedin-outbound-angle` | — |
| Campaign design | `campaign-angle-finder`, `outbound-campaign-architect` | — |
| Routing + writing | `copywriting-vp-sequence` / `copywriting-manager-sequence` / `copywriting-ic-sequence`, `copywriting-first-touch`, `copywriting-follow-up`, `cta-designer` | — |
| Quality gate | `copywriting-refiner`, `copywriting-analyzer`, `gtm-action-thinker` | — |
| Approval gate | (Yalc-side dryrun + user `approve`) | — |
| Push | — | `create_campaign_with_sequence`, `add_sequence_step` × 2, `add_lead_to_campaign` × N, `validate_campaign_readiness` (campaign stays in DRAFT) |

Detailed stage-by-stage breakdown in [SKILL.md](./SKILL.md).

## Safety contract

- DRAFT state by default — the orchestrator never calls `set_campaign_state` with action `start`. Never auto-sends.
- Dryrun JSON written before any MCP push.
- Default lead ceiling: 50 (raise with an explicit instruction).
- Explicit `approve` blocks the push.
- No silent retries on MCP errors.

## Email enrichment for leads without `potential_email`

`lemleads_search` returns a `potential_email` field for most but not all leads (typically 70-85% coverage). For the missing-email subset, the orchestrator surfaces an `email_coverage_percent` figure in the dryrun and offers three paths:

1. **Skip** — drop leads without email. Default.
2. **Use a Yalc enrichment skill via the fullenrich MCP** — recommended. Yalc bundles `fullenrich-plg-reverse-lookup`, `fullenrich-content-engagers`, `fullenrich-network-activation`, `fullenrich-event-attendees`, and `enrich-with-signals`. Run the appropriate one on the missing-email subset (LinkedIn URL + name + company → verified email), then re-merge before stage 25d.
3. **Toggle `findEmail: true` on `add_lead_to_campaign`** — fastest but spends one lemlist credit per lead per flag. Only when the user explicitly opts in.

This separation keeps lemlist credits scoped to sourcing + sequence orchestration, while email enrichment runs through whichever enrichment provider is cheapest/most reliable for the specific use case.

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
