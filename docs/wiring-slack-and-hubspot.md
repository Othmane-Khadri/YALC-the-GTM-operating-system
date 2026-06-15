# Wiring Slack and HubSpot

This guide is the exact, battle-tested setup for running the five demo agents
from Slack with a HubSpot-connected CRM. It documents the real gotchas we hit
so you do not repeat them. All credentials are referenced by environment
variable name only; never commit real tokens. Put real values in `.env.local`
(gitignored).

The model is simple: a Slack DM wakes a Socket Mode listener, which spawns a
headless Claude Code process that reads the matching skill in `.claude/skills/`
and uses the MCP servers in `.mcp.json` to do the work, posting results back to
the Slack thread.

---

## Part 1: Slack

### 1.1 Create the Slack app (Socket Mode)

1. Create a new app at api.slack.com/apps (from scratch).
2. Enable **Socket Mode** (Settings -> Socket Mode). This is what lets the
   listener receive messages without a public URL.
3. Under **Event Subscriptions**, subscribe the bot to: `message.im` (direct
   messages) and `app_mention` (channel mentions).

### 1.2 Scopes

Add these **Bot Token Scopes** (OAuth and Permissions):

- `chat:write` (post and reply)
- `reactions:write` (acknowledge approvals)
- `im:history`, `channels:history`, `groups:history` (read DMs and threads)
- `channels:read`, `users:read` (resolve channels and users)

Generate an **App-Level Token** (Basic Information -> App-Level Tokens) with the
`connections:write` scope. This is the `xapp-` token Socket Mode needs.

Install the app to the workspace. Copy the **Bot User OAuth Token** (`xoxb-`).

### 1.3 Environment variables

Add to `.env.local`:

```
SLACK_BOT_TOKEN=xoxb-...        # Bot User OAuth Token
SLACK_APP_TOKEN=xapp-...        # App-Level Token (Socket Mode)
SLACK_SIGNING_SECRET=...        # Basic Information -> Signing Secret
SLACK_TEAM_ID=T...              # workspace id (auth.test returns team_id)
```

GOTCHA: `SLACK_TEAM_ID` is **required**. The Slack MCP server fails to register
its tools without it, and you will see the agent fall back to raw API calls or
report no Slack tools. Get it from `auth.test`:

```
curl -s -X POST https://slack.com/api/auth.test \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}"   # returns team_id
```

### 1.4 Register the Slack MCP

In `.mcp.json`:

```json
"slack": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-slack"],
  "env": {
    "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
    "SLACK_TEAM_ID": "${SLACK_TEAM_ID}"
  }
}
```

This exposes `slack_post_message`, `slack_reply_to_thread`,
`slack_get_thread_replies`, `slack_add_reaction`. Note there is no native
message-update tool; post a new message instead of editing.

### 1.5 Boot the listener

```
npx tsx src/cli/index.ts slack:listen
```

You should see `dispatching inbound to Claude Code subprocess` and
`listening (Socket Mode)`. DM the bot to trigger an agent.

### 1.6 Slack gotchas we hit (and the fixes)

- **`--verbose` is required.** The listener spawns Claude Code with
  `--print --output-format stream-json`. The CLI rejects that combo unless
  `--verbose` is also passed; without it the child exits with code 1 and the
  bot never replies. Already handled in `spawn-claude-handler.ts`.
- **Reply inline in DMs, do not thread.** A fresh top-level DM has no
  `thread_ts`. Deriving the reply target from the message id buries the reply
  under a hidden "1 reply" thread, which looks like no answer. Only continue an
  existing thread; otherwise reply at the top level. Handled in `slack-input.ts`.
- **Run the database migration.** The listener checks an approvals table on
  every inbound message. A fresh checkout has no such table and every message
  throws `no such table: slack_approvals`. Run `npm run db:push` once.
  `DATABASE_URL` is resolved relative to the working directory, so each checkout
  or worktree needs its own migrated database.
- **Auth for the spawned process.** The headless child needs a working Claude
  auth: either a logged-in subscription (do not pass `ANTHROPIC_API_KEY` to the
  child, so it uses the subscription) or a funded `ANTHROPIC_API_KEY`. An empty
  API-key balance makes every run die with "Credit balance is too low".
- **Always-on on macOS.** If you keep the listener running via launchd and the
  repo lives under `~/Desktop`, the launchd process needs Full Disk Access to
  read the repo and `.env.local`, otherwise it crashloops with
  "operation not permitted". Run it through a launcher binary that has Full Disk
  Access granted.

---

## Part 2: HubSpot

### 2.1 Use a Private App token, not the hosted OAuth gateway

GOTCHA (the big one): HubSpot's hosted MCP gateway at `mcp.hubspot.com` is
OAuth-only and **rejects a private app token with 401**. Do not use it for a
headless setup. Use HubSpot's **local** MCP server, which accepts a private app
token directly and works without any browser round trip.

### 2.2 Create the Private App token

1. HubSpot -> Settings -> Integrations -> **Private Apps** -> Create.
2. Grant CRM scopes: `crm.objects.contacts` (read/write),
   `crm.objects.deals` (read), `crm.objects.notes` (write),
   `crm.schemas.contacts` (read), and associations as needed.
3. Copy the **access token** (looks like `pat-eu1-...` or `pat-na1-...`,
   region-prefixed).

### 2.3 Environment variable

```
HUBSPOT_API_KEY=pat-...   # HubSpot private app access token
```

### 2.4 Register the HubSpot MCP

In `.mcp.json`:

```json
"hubspot": {
  "command": "npx",
  "args": ["-y", "@hubspot/mcp-server"],
  "env": {
    "PRIVATE_APP_ACCESS_TOKEN": "${HUBSPOT_API_KEY}"
  }
}
```

Verify with `claude mcp list` from the project root; HubSpot should report
`Connected`. MCP servers connect a few seconds after a process starts, so a very
short run may act before they are ready; real skill runs wait for them.

### 2.5 HubSpot gotchas we hit

- **Missing portal properties.** Some portals do not have a `linkedin_url`
  contact property. Writing to a non-existent property errors; write the
  LinkedIn URL into a note body instead, or create the property first.
- **Upsert returns 409 when the contact already exists.** Treat a 409 as
  "already there", parse the existing contact id from the response, and continue
  rather than failing.

---

## Verifying the whole loop

```
claude mcp list        # lemlist, hubspot, slack (and claap) all Connected
npx tsx src/cli/index.ts slack:listen
```

Then DM the bot, for example `map the buying committee at <company>`. You should
see progress messages stream into the thread and a final draft/preview, with
nothing sent automatically.
