# Setup — Claap MCP, env, Notion DB, Slack

## TL;DR — let the skill set itself up

The skill ships with an interactive **SETUP MODE** that walks you through
every step below. **Run the skill once in Claude Code with no arguments**
and it will:

1. Detect (or help you register) the Claap MCP.
2. Detect (or help you persist) `CLAAP_API_KEY` to your shell rc — without
   ever echoing the key back in chat.
3. Detect the Notion MCP.
4. Ask which Notion page to put the GTM Action Items DB under, then create
   the DB + Kanban view from the verified JSON contract in
   `notion-db-schema.md`.
5. Ask which signals to extract from transcripts (default 5; customizable).
6. Ask for Kanban columns and any extra DB properties.
7. Ask how to deliver the Slack summary (DM, channel, or webhook env var).
8. Persist non-secret choices to `.claap-config.json` (excluded from git
   via the skill folder's `.gitignore`).

When it's done, the skill prints "Setup complete. Run me again to generate
this week's recap." Then schedule it (see `../SKILL.md` § Running on a
Schedule).

This document is the **manual fallback** if you'd rather wire each piece
yourself. Plan on 5–10 minutes.

---

## Manual setup — step by step

### 1. Generate a Claap API key

1. Sign in at `app.claap.io`.
2. Settings → Integrations → API Keys → "Create new key".
3. Scope: select the workspace whose recordings you want to read.
4. Copy the key. You'll only see it once.

Store it in your shell environment (never in `.claap-config.json`):

```bash
# zsh
echo 'export CLAAP_API_KEY="<YOUR_CLAAP_KEY>"' >> ~/.zshenv

# bash
echo 'export CLAAP_API_KEY="<YOUR_CLAAP_KEY>"' >> ~/.bashrc
```

Reload your shell (`exec zsh` or `exec bash`) before continuing.

### 2. Register Claap MCP in Claude Code

Claap exposes a single HTTP MCP endpoint at `https://api.claap.io/mcp`.
Add it to your project's `.mcp.json` (or `~/.claude/settings.json` for
user-scope):

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

Restart Claude Code. Verify with `/mcp`.

The claude.ai connector exposes the same tools under the
`mcp__claude_ai_Claap__` prefix; either prefix works. SETUP MODE auto-
detects and records the active prefix.

### 3. Create the Notion GTM Action Items DB

Run the JSON `notion-create-database` body in
[`notion-db-schema.md`](notion-db-schema.md). The MCP returns the new DB
URL and `data_source` UUID in one response. Capture both.

> Pseudo-SQL (`CREATE TABLE …`) is **not** a valid input — Notion's MCP
> wants the JSON property objects. SETUP MODE submits this for you with
> your chosen Kanban column names and any extra properties.

Then call `notion-fetch` on the new data source to read each property's
`property_id`, and submit the `notion-create-view` JSON body in
`notion-db-schema.md` to create the board view grouped by `Status`.

### 4. Wire up Slack delivery

Pick one:

**Option A — Slack MCP (DM or channel).** If the claude.ai Slack connector
is enabled, `slack_send_message` will work in interactive sessions. For
headless `claude -p` runs, the connector may not auto-load — fall back to
Option B in that case.

Get your user ID via Slack (avatar → View profile → ... → Copy member ID).

**Option B — Slack incoming webhook (no MCP, works in any context).**

1. <https://api.slack.com/messaging/webhooks> → "Create app" → "From
   scratch" → pick your workspace.
2. Enable "Incoming Webhooks" → "Add New Webhook to Workspace" → pick the
   channel or "Directly to yourself".
3. Copy the webhook URL (starts with `https://hooks.slack.com/services/...`).
4. Export it as an env var — **never** paste it into `.claap-config.json`:

```bash
# zsh
echo 'export SLACK_WEBHOOK_URL="<YOUR_SLACK_WEBHOOK_URL>"' >> ~/.zshenv

# bash
echo 'export SLACK_WEBHOOK_URL="<YOUR_SLACK_WEBHOOK_URL>"' >> ~/.bashrc
```

The skill's `slack_delivery` config records `"target": "env:SLACK_WEBHOOK_URL"`
and resolves it at run time.

### 5. Write `.claap-config.json`

If you skipped SETUP MODE, write the config file by hand at
`.claude/skills/claap-weekly-recap/.claap-config.json`. Schema is documented
in `../SKILL.md` § Config File.

The skill folder ships a `.gitignore` excluding this file from version
control.

### 6. Run the skill once interactively

In Claude Code, from a session where Claap + Notion + Slack MCPs all load:

```
Run the claap-weekly-recap skill.
```

The agent reads `.claap-config.json` and executes the 8-step workflow.

### 7. Schedule it

Pick the scheduler that matches your environment — see `../SKILL.md`
§ Running on a Schedule. Most users on macOS use Option B (launchd).

The wrapper script template handles either Slack path — it sources
whichever env var is available.

---

## What you should see after the first scheduled run

- Notion Kanban: 5–15 new cards in your `Backlog` and `Focus This Week`
  columns
- Slack message: a single short summary referencing the Notion link
- A history file at `~/.gtm-os/state/claap-recap-history.md` with this
  week's focus block titles

Next week's run references the history file to flag carry-over ("pricing
objection still surfacing — was 4 deals last week, 6 this week").

---

## Known limitations

- Claap REST endpoints (`api.claap.io/v1/*`) return 401 with the MCP key.
  The Yalc thin persistence slice (`yalc-gtm calls:sync`) is therefore
  parked until Claap exposes a REST scope on the same key. The skill
  itself runs entirely on MCP and is not affected.
- The Slack MCP from claude.ai (`mcp__claude_ai_Slack__*`) is OAuth-bound
  to your interactive web session and may not auto-load in headless
  `claude -p`. Use the webhook path for headless reliability.
- If your Slack workspace blocks DMs from new apps, the bot scope may
  need approval. Webhook URLs sidestep this.

See `troubleshooting.md` for symptom → cause → fix mappings.
