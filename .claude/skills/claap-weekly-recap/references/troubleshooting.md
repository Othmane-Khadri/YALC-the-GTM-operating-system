# Troubleshooting — claap-weekly-recap

Symptom → cause → fix. If a row doesn't match what you're seeing, open an
issue with the log line that surprised you.

## Claap MCP

| Symptom | Cause | Fix |
|---|---|---|
| `claap` missing from `/mcp` | Env not loaded at MCP-launch time | `printenv CLAAP_API_KEY` — if empty, set in `~/.zshenv` or `~/.bashrc`, restart Claude Code. |
| MCP loads but `list_workspaces` returns 401 | Key invalid, expired, or scoped wrong | Regenerate in Claap → Settings → API Keys. Update env. Restart Claude Code. |
| `list_workspaces` returns `[]` | Key scoped to a workspace you don't recognize | Try a fresh key with broader scope. |
| `${CLAAP_API_KEY}` interpolation not applied (literal `${...}` sent as auth header) | Headless `claude -p` doesn't always interpolate `.mcp.json` env vars | Use `--mcp-config` with a temp file containing the literal key — see `scripts/run.sh.template` for a `unset ANTHROPIC_API_KEY`-safe pattern. |
| Tool name resolution fails — neither `mcp__claap__*` nor `mcp__claude_ai_Claap__*` works | Wrong prefix recorded in `.claap-config.json` | Delete `.claap-config.json` and re-run the skill to re-enter SETUP MODE. |
| Scheduled run can't see `CLAAP_API_KEY` even though interactive session can | launchd / cron / systemd doesn't inherit shell rc | `scripts/run.sh.template` sources `~/.gtm-os/.env` explicitly. Put `CLAAP_API_KEY=...` in that file (no `export`). |

## Notion

| Symptom | Cause | Fix |
|---|---|---|
| `notion-fetch` returns no DS at the configured ID | DS ID is wrong, or workspace permissions changed | Open the DB in Notion. Click `...` → Copy link. Run `notion-fetch <URL>` and grab the new `collection://...`. Update `.claap-config.json`. |
| `notion-create-pages` rejects a property as "unknown" | Property name mismatch — Notion is case-sensitive and treats whitespace literally | `notion-fetch` the DS. Compare keys in `properties` against the names in `references/notion-db-schema.md`. Common mismatch: `Deal/Lead` vs `Deal / Lead` (must include the spaces). |
| `notion-create-pages` rejects a select value | The option doesn't exist on that property | Run `notion-update-data-source` to add it. **Include `{"id": "<existing-id>"}` entries for every existing option you want to keep** — omitting an existing option removes it and orphans tagged pages. |
| Pseudo-SQL `CREATE TABLE` / `ALTER COLUMN` is rejected | Older versions of the README used pseudo-SQL — Notion's MCP only accepts the JSON property objects | Use the JSON contract in `references/notion-db-schema.md`. |
| Kanban view doesn't appear after `notion-create-view` | Wrong `data_source_id`, or `property_id` for Status was stale | `notion-fetch` the DS again. The `property_id` strings change if the DB schema was edited. Re-submit the view body with fresh IDs. |
| Idempotency dedupe lets duplicates through | Action Items don't share `Claap Link` (e.g. quote-only cards), and `Verbatim Quote` fingerprint differs by a stray space | Normalize fingerprints: lowercase + collapse whitespace + strip surrounding punctuation. Update the fingerprint function in Step 6. |
| Idempotency dedupe rejects everything | Re-running in the same week. Expected — skill short-circuits and reuses the existing Kanban URL in Slack | Verify by checking the `Week == <week_label>` filter returns the expected count. |

## Slack

| Symptom | Cause | Fix |
|---|---|---|
| Slack MCP DM never arrives | Bot scope not approved in workspace, OR user has DM-from-app blocked | Move `slack_delivery.mode` to `webhook`. Workspace admin can also approve the Slack connector app. |
| `slack_send_message` returns `channel_not_found` | `target` is a handle (`@othmane`) not a user ID (`<U_YOUR_SLACK_ID>`) | Resolve via `slack_search_users` and record the `U...` ID in config. |
| Webhook POST returns `404 no_service` | Webhook URL was rotated or deleted in Slack | Generate a fresh webhook, re-export `SLACK_WEBHOOK_URL`, update shell rc. |
| Webhook POST returns `400 invalid_payload` | JSON not escaped — process substitution `<(jq ...)` sometimes drops bytes in cron shells | Use the temp-file pattern in `SKILL.md` Step 7 (write JSON to file first, then `curl --data-binary @file`). |

## Scheduled run can't find `CLAAP_API_KEY`

The bare cron / launchd environment doesn't source `~/.zshenv` or
`~/.bashrc`. `scripts/run.sh.template` works around this two ways:

1. The script reads `~/.gtm-os/.env` (literal `KEY=VAL` lines, no `export`).
2. If that file is missing and the env var isn't already set by the
   plist/timer, the script aborts with a clear log line.

Fix: add `CLAAP_API_KEY=...` (no `export`, no quotes) to `~/.gtm-os/.env`.

## Idempotency dedupe edge cases

- **Card text was edited in Notion after a prior run.** The fingerprint
  for that card differs from what the skill would generate this week, so
  the skill creates a duplicate. Workaround: keep the `Claap Link` URL
  immutable on those cards — it's the primary fingerprint key.
- **Multiple Focus Blocks with the same title.** Treat the title as a
  natural key. SETUP MODE warns users not to invent two focus blocks with
  identical titles in one week.
- **`Week` property edited.** If the user manually changes the `Week`
  value on an existing card, the idempotency filter won't see it and a
  duplicate is created. Don't edit `Week`; archive the card instead.

## Model / max_turns

- **Run hits the turn cap and stops mid-write.** Bump `max_turns` in
  `.claap-config.json` (default 100). Long weeks with 15+ calls can take
  ~70 turns.
- **Run is too expensive on Opus.** Set `"model": "claude-sonnet-4-6"`
  in config — quality difference on extraction is small; cost is much
  lower.
