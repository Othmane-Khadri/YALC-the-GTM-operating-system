# claap-weekly-recap

A Claude Code skill that turns a week of Claap-recorded sales calls into a
Notion Kanban of action items + focus blocks, delivered with a Slack
summary every Sunday morning.

## What it does

Every time it runs (default: Sunday 08:00 local), the skill:

1. Pulls the last 7 days of Claap recordings via Claap MCP
2. Extracts per-deal action items with the prospect's verbatim wording + a
   timestamped Claap link to the moment in the call
3. Synthesizes 2–4 focus blocks (patterns across multiple calls — e.g.
   "pricing objection rebuttal — surfaced in 4 deals")
4. Writes everything to a Notion Kanban DB (default columns: Backlog /
   Focus This Week / Done / Archived; customizable in SETUP MODE)
5. Sends a single Slack DM, channel post, or webhook message with a link
   back to the Kanban
6. Logs focus block titles to a history file so next week's run can
   detect carry-over
7. Skips re-creating cards that already exist for the same week
   (idempotency guard — running twice on the same Sunday won't duplicate)

## Why it exists

Most "AI meeting notes" tools stop at one-meeting summaries. The actual
GTM problem is: 11 calls happened this week, the signal is scattered
across 11 recordings, and on Sunday morning you can't remember which
prospect said what or what to focus on next week. This skill turns the
week into a week's worth of decisions.

## Quickstart

**Run the skill once in Claude Code with no arguments.** It walks you
through setup interactively (SETUP MODE) — detects Claap and Notion MCPs,
helps you persist `CLAAP_API_KEY` to your shell rc without ever echoing
it back, creates the Notion DB + Kanban view, and writes a
`.claap-config.json` with your structural choices. Secrets never go in
config.

When SETUP MODE finishes, run the skill again to generate this week's
recap. Then schedule it (see § Schedule it).

## Prerequisites

- A Claap account with recordings (free trial works: `claap.io`)
- A Claap API key — generate at `app.claap.io → Settings → API Keys`
- A Notion workspace with the Notion MCP connected (claude.ai connector
  or `mcp.notion.com`)
- A Slack workspace with either the Slack MCP connected **or** a Slack
  incoming webhook URL

Full manual fallback in [`references/setup.md`](references/setup.md).

## Schedule it (pick one)

- **macOS launchd** (primary path on macOS): copy
  [`scripts/run.sh.template`](scripts/run.sh.template) +
  [`scripts/launchd.plist.template`](scripts/launchd.plist.template) to
  your local paths, fill in placeholders, `launchctl load` the plist.
- **Linux cron**: see [`scripts/cron-example.txt`](scripts/cron-example.txt).
- **Linux systemd**: see [`scripts/systemd.timer.template`](scripts/systemd.timer.template).
- **Yalc agent system** (cross-platform, **only if** you have the Yalc
  stack installed; skip if you only downloaded this skill folder): see
  the YAML snippet in [`SKILL.md`](SKILL.md) § Running on a Schedule.

The wrapper script reads `model` and `max_turns` overrides from
`.claap-config.json`, defaulting to `claude-sonnet-4-6` and `100`.

## Files in this skill

```
.claude/skills/claap-weekly-recap/
├── SKILL.md                          ← agent definition (the system prompt Claude reads)
├── README.md                         ← this file
├── .gitignore                        ← excludes .claap-config.json and *.local.json
├── references/
│   ├── setup.md                      ← manual setup fallback (SETUP MODE preferred)
│   ├── notion-db-schema.md           ← verified Notion MCP JSON contract (no pseudo-SQL)
│   ├── sample-output.md              ← a real run's outputs (action items + Slack DM)
│   └── troubleshooting.md            ← symptom → cause → fix
└── scripts/
    ├── run.sh.template               ← wrapper for headless `claude -p`
    ├── launchd.plist.template        ← macOS scheduled run
    ├── cron-example.txt              ← Linux cron alternative
    └── systemd.timer.template        ← Linux systemd alternative
```

`.claap-config.json` is created by SETUP MODE and is gitignored.

## Notion DB schema (10 properties, default)

| Property | Type | Notes |
|---|---|---|
| `Title` | title | Action sentence or focus block name |
| `Type` | select | `Action Item` / `Focus Block` |
| `Status` | select | `Backlog` / `Focus This Week` / `Done` / `Archived` (Kanban grouping; customizable) |
| `Deal / Lead` | rich_text | Deal identifier (empty for focus blocks) |
| `Verbatim Quote` | rich_text | Prospect's exact wording from the call |
| `Claap Link` | url | Timestamped URL into the recording |
| `Source Call Date` | date | When the originating call happened |
| `Surfaced By` | select | `Weekly Recap Agent` / `Manual` |
| `Week` | rich_text | ISO week label (e.g. `2026-W20`) |
| `Due` | date | Optional, only when the call explicitly promised a date |

The verified `notion-create-database` JSON body lives in
[`references/notion-db-schema.md`](references/notion-db-schema.md).
SETUP MODE adds any extra properties you request on top of the default 10.

## What ships with this skill vs what you bring

| Ships with this skill | You bring |
|---|---|
| The system prompt (`SKILL.md`) including SETUP MODE | Claap account + API key |
| Verified Notion JSON contract + DB-creation script | A Notion workspace (and Notion MCP) |
| Scheduler templates (launchd / cron / systemd / Yalc agent yaml) | A Slack user ID, channel ID, or webhook URL |
| Sample output for sanity-checking | One run to seed the history file |
| Troubleshooting playbook | — |

## Companion code (Yalc OSS repo)

For orchestrator skills that run in Node (cold email, qualifier,
personalize) and need to JOIN against transcripts in local SQLite, the
Yalc repo also includes a thin persistence slice:

- `callRecordings` + `callTranscripts` tables ([`src/lib/db/schema.ts`](../../../src/lib/db/schema.ts))
- Claap REST service ([`src/lib/services/claap.ts`](../../../src/lib/services/claap.ts))
- Inbound webhook handler at `POST /webhooks/claap` ([`src/lib/server/routes/claap-webhook.ts`](../../../src/lib/server/routes/claap-webhook.ts))
- `yalc-gtm calls:sync --lookback-days 7` CLI ([`src/cli/commands/calls.ts`](../../../src/cli/commands/calls.ts))

You don't need any of this if you only want the skill. It's there for the
orchestrator path.

## Status notes

- Claap MCP endpoint at `https://api.claap.io/mcp` is stable;
  `CLAAP_API_KEY` authenticates over `Authorization: Bearer …`.
- Claap REST endpoints return 401 with the same MCP key — they likely
  require a separate REST scope. The Yalc thin slice will work once
  Claap exposes a REST scope on the same key. The skill itself doesn't
  need REST; MCP is sufficient.

## License

Same as the parent repository.
