# Lost Deal Revival Agent — Operator Setup

This skill receives fire payloads from the signal-pair watcher and writes
a drafted revival message to one of two output targets. It does not send
messages. It does not start Lemlist campaigns. Operators always review
before send.

## Prerequisites

- The signal-pair watcher is installed and scheduled.
  See `configs/agents/signal-pair-watcher.yaml`.
- Claap account with API access. Get a Claap API key.
- One of:
  - HubSpot private-app token (default output mode), OR
  - Lemlist API key (alternative output mode).
- Slack delivery configured (webhook URL or a Slack MCP target).

## 1. Export env vars

In your shell rc (`~/.zshenv` or `~/.bashrc`):

```bash
export CLAAP_API_KEY="..."           # required
export HUBSPOT_API_KEY="..."         # required when output_mode=crm_task
export LEMLIST_API_KEY="..."         # required when output_mode=lemlist_draft
export SLACK_WEBHOOK_URL="..."       # optional, for webhook delivery
```

Restart your shell after editing.

## 2. Register the Claap MCP

Add to `<workspace>/.mcp.json`:

```json
{
  "mcpServers": {
    "claap": {
      "url": "https://api.claap.io/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer ${CLAAP_API_KEY}"
      }
    }
  }
}
```

Restart Claude Code so the MCP loads.

## 3. Copy the objection-signal map

```bash
mkdir -p ~/.gtm-os
cp configs/objection-signal-map.template.yaml ~/.gtm-os/objection-signal-map.yaml
```

Edit `~/.gtm-os/objection-signal-map.yaml` to add or remove signal types
that contradict each objection category. Keep the five top-level keys:
`pricing`, `headcount`, `timing`, `integration`, `competitor`.

## 4. Write the tenant config

Create `~/.gtm-os/lost-deal-revival.json`:

```json
{
  "version": 1,
  "output_mode": "crm_task",
  "objection_signal_map_path": "~/.gtm-os/objection-signal-map.yaml",
  "claap_tool_prefix": "mcp__claap__",
  "slack_operator_id": "<U_YOUR_SLACK_ID>",
  "hubspot_owner_id": "<HUBSPOT_OWNER_ID>",
  "lemlist_campaign_prefix": "Revival -",
  "task_due_offset_hours": 24,
  "model": "claude-sonnet-4-6"
}
```

### Output modes

- `crm_task` (default). Writes a HubSpot task via the `crm-create-task`
  capability. Subject: `Revive: {company}`. Body: the drafted 2 lines,
  the Claap quote, the public change summary. Due: now + 24h. The rep
  reviews the task in their HubSpot queue.
- `lemlist_draft`. Stages a Lemlist campaign in DRAFT status with a
  single-step sequence whose body is the drafted message. The skill
  **never** starts the campaign. Operator reviews in Lemlist and starts
  the campaign manually if they want to send.

## 5. Configure signal_watches rows

For each company you want this agent to revive, insert a row into
`signal_watches` with:

- `entity_type = "company"`
- `entity_id = "<domain>"`
- `entity_name = "<company name>"`
- `signal_types = JSON array with two entries`:
  - one prefixed `objection:` (e.g. `objection:headcount`)
  - one prefixed `signal:` (e.g. `signal:hiring_surge`)
- `orchestrator_skill_id = "lost-deal-revival-agent"`

This is the line that ties the watcher to this skill. The watcher reads
`orchestrator_skill_id`, the skill registry resolves it, and the watcher
invokes the skill's `execute()` with the fire payload.

## 6. Install and test

```bash
cp configs/agents/lost-deal-revival-agent.yaml ~/.gtm-os/agents/lost-deal-revival-agent.yaml
npx tsx src/cli/index.ts agent:install --agent lost-deal-revival-agent
```

### Simulating without waiting for live signals

To test the end-to-end revival path without waiting for the watcher to
fire on a real signal, run with `--input simulate=true`. The skill will
inject a fixture payload:

```bash
npx tsx src/cli/index.ts agent:run --name lost-deal-revival-agent --input simulate=true
```

This is the recommended way to verify Claap MCP, HubSpot or Lemlist, and
Slack wiring before going live.

## Failure modes

- `mismatched_pair` — the watcher invoked the skill with an objection /
  signal combination that is not whitelisted in the map. The skill logs
  and exits cleanly. No CRM writes, no Lemlist writes, no Slack DM.
- `claap_no_transcript` — Claap returned nothing for the company. Hard
  stop. Check that the closed-lost call is actually in Claap and that
  the company name in `signal_watches.entity_name` matches the call
  title or a participant email.
- `dash_scan_failed` — the draft did not pass the outbound rail after a
  single retry. Hard stop. Open `src/lib/outbound/rules.ts` to see which
  rule failed, and tighten the revival-copywriter prompt.
- `crm_create_task_failed` / `lemlist_create_failed` — vendor error.
  Hard stop. Check the env var for that vendor and re-run.
- `slack_delivery_failed` — logged but does not roll back the CRM /
  Lemlist write. Fix the Slack wiring and the next fire will land.

## Operator review queue

The Slack DM you receive on every fire contains the verbatim drafted
message, the original Claap quote, and a link or id to the output
target. Always read both lines before approving the send.
