# Slack MCP Setup

This MCP entry wraps Slack's Web API for the Yalc.ai demo Slack app. It is
registered in `.mcp.json` under the `slack` key.

## Package

`@modelcontextprotocol/server-slack` (official, bot-token based, `xoxb-` token).

It runs as a plain stdio server via `npx`, matching the existing `npx` entry
style used by the `lemlist` server.

### Why this package

The four required Web API methods were checked against the common bot-token
Slack MCP packages on npm:

| Package | post | thread replies | reaction add | message update |
| --- | --- | --- | --- | --- |
| `@modelcontextprotocol/server-slack` | yes | yes | yes | no |
| `@teamsparta/mcp-server-slack` | yes | yes | yes | no |
| `slack-mcp-server` (korotovsky) | yes | yes | yes | no |

No widely-used bot-token package exposes a native `chat.update` tool. The
official Anthropic-maintained server was chosen because it is the best
maintained bot-token option and matches the repository's existing `npx` entry
convention. Three of the four required methods are native; `chat.update` needs
the documented workaround below.

## Required environment variables

Set these in `~/Desktop/gtm-os/.env.local` (gitignored). In committed files they
are referenced by name only.

- `SLACK_BOT_TOKEN` - Yalc.ai Slack app Bot User OAuth Token (`xoxb-...`). This
  is the trailing `SLACK_*` block in `.env.local` (last-wins), NOT the older
  `yalc_brain` tokens.
- `SLACK_TEAM_ID` - workspace team id (`T...`). Optional for posting and
  threads; required by `slack_list_channels` and `slack_get_users`.

Required Slack OAuth bot scopes:

- `chat:write` (post and update messages)
- `reactions:write` (add reactions)
- `channels:history` / `groups:history` (read thread replies)
- `channels:read`, `users:read` (list channels and users)

## Tool coverage vs required methods

Confirmed from the live spawn test below, the server exposes 8 tools:

- `slack_list_channels`
- `slack_post_message` -> `chat.postMessage` (required, native)
- `slack_reply_to_thread`
- `slack_add_reaction` -> `reactions.add` (required, native)
- `slack_get_channel_history`
- `slack_get_thread_replies` -> `conversations.replies` (required, native)
- `slack_get_users`
- `slack_get_user_profile`

Coverage of the four required methods:

| Required method | Status |
| --- | --- |
| `chat.postMessage` | Native (`slack_post_message`) |
| `conversations.replies` | Native (`slack_get_thread_replies`) |
| `reactions.add` | Native (`slack_add_reaction`) |
| `chat.update` | NOT native - workaround below |

### `chat.update` workaround

The server has no update tool. To edit an already-posted message, call the
Slack Web API directly with the same `SLACK_BOT_TOKEN`. Capture the `ts` of the
target message (returned by `slack_post_message`), then:

```bash
curl -s -X POST https://slack.com/api/chat.update \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"channel":"<CHANNEL_ID>","ts":"<MESSAGE_TS>","text":"updated text"}'
```

This uses the same bot token and `chat:write` scope already granted, so no
extra setup is needed. If a fully MCP-native `chat.update` becomes required,
swap the package for one that exposes an update tool or add a thin local MCP
wrapper around `chat.update`.

## Spawn test

Run once to confirm the server boots and lists its tools. Source the token from
the gitignored env file at runtime; never inline or print the token value.

```bash
# Load the Yalc.ai bot token (last-wins trailing block in .env.local).
export SLACK_BOT_TOKEN="$(grep -E '^SLACK_BOT_TOKEN=' ~/Desktop/gtm-os/.env.local | tail -n1 | cut -d= -f2- | tr -d '"'"'"'"'"'"')"
export SLACK_TEAM_ID="$(grep -E '^SLACK_TEAM_ID=' ~/Desktop/gtm-os/.env.local | tail -n1 | cut -d= -f2- | tr -d '"'"'"'"'"'"')"

# Drive one initialize + tools/list cycle over stdio and print the tool names.
node - <<'NODE'
import { spawn } from "node:child_process";
const child = spawn("npx", ["-y", "@modelcontextprotocol/server-slack"], {
  env: { ...process.env, SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN, SLACK_TEAM_ID: process.env.SLACK_TEAM_ID || "T000000" },
  stdio: ["pipe", "pipe", "pipe"],
});
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m.id === 2 && m.result && m.result.tools) {
        console.log("TOOLS:");
        for (const t of m.result.tools) console.log(" -", t.name);
        child.kill(); process.exit(0);
      }
    } catch {}
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "spawn-test", version: "1.0.0" } } });
setTimeout(() => { send({ jsonrpc: "2.0", method: "notifications/initialized" }); send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }); }, 1500);
setTimeout(() => { console.error("TIMEOUT"); child.kill(); process.exit(1); }, 45000);
NODE
```

Expected output: the 8 tool names listed above, ending the process cleanly.

Optional read-only token check (no side effects), confirms the token
authenticates against the workspace:

```bash
curl -s -X POST https://slack.com/api/auth.test \
  -H "Authorization: Bearer ${SLACK_BOT_TOKEN}" | grep -o '"ok":[a-z]*'
# expect: "ok":true
```

## Troubleshooting

- `invalid_auth` or `not_authed`: the token is missing or wrong. Confirm
  `SLACK_BOT_TOKEN` resolves to the Yalc.ai app `xoxb-` token, not the older
  `yalc_brain` token. Re-run the `auth.test` check above.
- `missing_scope`: add the scope named in the error to the Yalc.ai app and
  reinstall the app to the workspace, then re-export the refreshed token.
- `slack_list_channels` / `slack_get_users` fail with a team error: set
  `SLACK_TEAM_ID` to the workspace `T...` id. Posting, threads, and reactions do
  not need it.
- Spawn hangs on first run: `npx -y` is downloading the package. Re-run once the
  download finishes, or pre-install with
  `npx -y @modelcontextprotocol/server-slack --help`.
- `channel_not_found`: invite the bot to the target channel
  (`/invite @<bot>`), or use a channel id the bot is a member of.
- Editing a message: the server has no update tool. Use the `chat.update`
  workaround above with the message `ts`.
