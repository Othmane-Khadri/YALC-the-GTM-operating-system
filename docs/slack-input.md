# Slack input listener

`yalc-gtm slack:listen` boots an inbound Slack listener built on the official
[`@slack/bolt`](https://slack.dev/bolt-js) SDK in Socket Mode. The listener
forwards inbound direct messages, mentions, and reactions to a handler and
resolves pending approvals stored in the `slack_approvals` SQLite table.

## What it does

| Event | Behavior |
| --- | --- |
| `message` (DM only, `channel_type === 'im'`) | Forwarded to the handler. Thread replies from the original requester also resolve a pending approval. The resolver accepts the legacy literal commands (`/yalc approve <runId>` and `/yalc cancel <runId>`) **and** free-text intent like `go`, `approve`, `looks good ship it`, `Hey, this is good. Go.`, `no thanks`, `cancel`, `abort`. |
| `app_mention` | The `<@BOTID>` prefix is stripped and the remainder is forwarded to the handler. |
| `reaction_added` on a thread root | If a pending approval exists for that thread, a thumbs-up from the original requester approves it; thumbs-down rejects. Reactions from anyone else are ignored. |

### Natural-language approval intent

Free-text replies are scored by a chained intent classifier:

1. A small regex pass catches the obvious cases (`yes`, `lgtm`, `ship it`,
   `cancel`, `nope`, `hold off`, etc.) without a network call. The literal
   `/yalc approve` and `/yalc cancel` commands are also covered here.
2. If the regex returns `unknown` and `ANTHROPIC_API_KEY` is set, a single
   Claude Haiku call decides between `approve`, `reject`, and `unknown`.
3. If both layers return `unknown`, the row stays `pending` and the reply is
   treated as ordinary conversation. The operator can follow up with `go` or
   `cancel` to finish.

When no `ANTHROPIC_API_KEY` is configured the listener falls back to rules
only. No crash; only fewer paraphrases get resolved.

Approval requests are inserted with `recordPending(threadTs, runId, requestedBy, channel)`.
Pending callers wait via `awaitApproval(threadTs, fromUserId, timeoutMs = 600000)`
which polls every 500 ms and falls through to `timeout` after the window.

Only the user who originated the approval (the `requested_by` column on the row)
can resolve it. This is intentional: any other operator in the channel reacting
or replying is treated as a no-op. If you need a different policy, fork the
resolver functions in `src/lib/server/slack-approval.ts`.

## Set up the Slack app

1. Open [api.slack.com/apps](https://api.slack.com/apps) and create a new app
   from scratch. Pick a workspace.
2. **Socket Mode.** Open the "Socket Mode" page in the sidebar and enable it.
   When prompted, generate an app-level token. Give it the `connections:write`
   scope and save the token (`xapp-...`). This is your `SLACK_APP_TOKEN`.
3. **OAuth & Permissions.** Add the following bot token scopes:
   - `app_mentions:read`
   - `chat:write`
   - `im:history`
   - `reactions:read`
4. **Event Subscriptions.** Enable events. Under "Subscribe to bot events",
   add: `app_mention`, `message.im`, `reaction_added`.
5. **App Home.** Enable the "Messages Tab" and check "Allow users to send
   Slash commands and messages from the messages tab" so the bot can receive DMs.
6. **Install to Workspace.** Approve the install. Copy the bot token
   (`xoxb-...`) shown on the OAuth page. This is your `SLACK_BOT_TOKEN`.
7. **Signing secret.** Open "Basic Information" and copy "Signing Secret".
   This is your `SLACK_SIGNING_SECRET`.

## Configure env vars

Add the three values to `~/.gtm-os/.env` (preferred) or `.env.local` in your
working directory:

```dotenv
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...
```

`xoxb-` and `xapp-` are different tokens; do not swap them.

## Run the listener

```bash
npx tsx src/cli/index.ts slack:listen
```

The process prints `[slack:listen] listening (Socket Mode)` once Bolt has
opened the socket. Leave it running.

## Test it

1. DM the bot from your workspace. The CLI prints a JSON line per inbound
   message containing `channel`, `threadTs`, `userId`, and `text`.
2. Mention the bot in a channel where it is installed. Same JSON output.
3. Trigger a code path that calls `recordPending(threadTs, runId, requestedBy, channel)`
   on a thread the bot has posted to. React with a thumbs-up from the same user
   account; the row's `state` flips to `approved` and any caller awaiting
   resolution returns.

## Files added in S3

- `src/lib/server/slack-input.ts`: Bolt wrapper and event dispatcher.
- `src/lib/server/slack-approval.ts`: approval store with reaction and reply resolvers.
- `src/cli/commands/slack-listen.ts`: CLI entry point.
- `src/lib/db/migrations/0003_slack_approvals.sql`: table migration.
- `src/lib/server/__tests__/slack-approval.test.ts`: coverage for the seven
  acceptance cases.
