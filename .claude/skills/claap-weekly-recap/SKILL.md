---
name: claap-weekly-recap
description: "Turns a week of Claap-recorded sales calls into action items and focus blocks on a Notion Kanban, delivered with a Slack summary. Use when the user says 'weekly call recap', 'turn my calls into action items', 'Sunday recap from Claap', 'what should I focus on next week based on my calls', 'pull this week's deal next steps from Claap', or schedules a recurring digest of recorded conversations. Side-effecting — reads Claap via MCP, writes Notion cards, sends a Slack DM. On first run with no config it enters an interactive SETUP MODE that walks the user through wiring everything up — no failed scheduled runs."
version: 2.0.0
---

# Claap Weekly Recap

Reads every Claap recording from the last N days, extracts per-deal action
items with verbatim quotes and Claap timestamp links, synthesizes weekly
focus blocks, writes them to a Notion Kanban DB, and delivers a Slack
summary. Designed to run unattended on a Sunday morning schedule **after**
the user runs it once interactively to seed config.

**You produce action items and focus blocks. You do NOT modify the
underlying call recordings, edit existing Notion cards beyond the
idempotency guard, or write to any database other than the GTM Action
Items DB recorded in config.**

## When This Skill Applies

- "give me the week in calls"
- "what did prospects ask for this week"
- "draft action items from my Claap calls this week"
- "Sunday recap from sales calls"
- "set up a weekly recap from Claap into Notion + Slack"

**NOT this skill:**
- "summarize this one call" — use Claap's own per-call summary in the app
- "ask my call history a question right now" — use Claap MCP directly

## Config File

The skill is driven by `.claude/skills/claap-weekly-recap/.claap-config.json`,
created on first run by SETUP MODE. **Secrets never live in this file.** Only
structural choices and non-sensitive IDs:

```json
{
  "version": 1,
  "claap_tool_prefix": "mcp__claap__",
  "gtm_action_items_data_source_id": "collection://<YOUR_DATA_SOURCE_UUID>",
  "notion_db_url": "https://www.notion.so/<workspace>/<db-id>",
  "slack_delivery": {
    "mode": "mcp_user",
    "target": "<U_YOUR_SLACK_ID>"
  },
  "lookback_days": 7,
  "min_call_minutes": 3,
  "extraction_signals": [
    "objection",
    "competitor_mention",
    "feature_request",
    "action_item",
    "next_step_promised"
  ],
  "kanban_statuses": ["Backlog", "Focus This Week", "Done", "Archived"],
  "extra_properties": [],
  "prior_recap_history_path": "~/.gtm-os/state/claap-recap-history.md",
  "model": "claude-sonnet-4-6",
  "max_turns": 100
}
```

Allowed `claap_tool_prefix` values:
- `mcp__claap__` (self-hosted / project-scoped Claap MCP)
- `mcp__claude_ai_Claap__` (claude.ai connector)

Allowed `slack_delivery.mode` values:
- `mcp_user` — `target` is a Slack user ID like `<U_YOUR_SLACK_ID>`
- `mcp_channel` — `target` is a channel ID like `<C_YOUR_CHANNEL_ID>`
- `webhook` — `target` is the literal string `env:SLACK_WEBHOOK_URL`. The
  webhook URL itself is **never** written to config; only the env-var name.

Secrets (must live in env or shell rc, never in config.json):
- `CLAAP_API_KEY` — required at MCP launch time
- `SLACK_WEBHOOK_URL` — only required if `slack_delivery.mode == "webhook"`

## Process

### SETUP MODE (interactive)

Enter SETUP MODE if **either** of these is true:
- The config file `.claude/skills/claap-weekly-recap/.claap-config.json`
  does not exist, OR
- A required runtime input (e.g. `gtm_action_items_data_source_id`) cannot
  be resolved AND no config file exists.

If config exists but is incomplete (e.g. version bump added a field), prompt
only for the missing pieces — don't restart from step 1.

Walk the user through these steps **one question at a time**. Wait for an
answer before moving on. Confirm each persisted choice.

**1. Resolve the Claap MCP tool prefix.**

Call `ListMcpResourcesTool`. Look for tool names starting with either:
- `mcp__claap__` (e.g. `mcp__claap__list_workspaces`)
- `mcp__claude_ai_Claap__` (e.g. `mcp__claude_ai_Claap__list_workspaces`)

If exactly one is present, record it as `claap_tool_prefix` and confirm with
the user. If both are present, ask which to use. If **neither** is present,
print the `.mcp.json` snippet below and **offer** to write it to
`<workspace>/.mcp.json` (creating or merging into `mcpServers`):

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

If the user declines, halt SETUP MODE with: "Add the Claap MCP to your
config and restart Claude Code, then re-run me." If the user accepts, write
the snippet, then halt with: "Restart Claude Code so the MCP loads, then
re-run me — I'll pick up where we left off."

**2. Confirm `CLAAP_API_KEY` is in env.**

Run `printenv CLAAP_API_KEY` via `Bash` and read the exit code only (do
**not** echo the value into chat under any circumstance). If it's set, say
"CLAAP_API_KEY detected — moving on." and continue.

If it's missing, ask the user to paste their key. Read it into a local
variable but **never repeat it back in chat**. Offer two persistence paths:

- Append `export CLAAP_API_KEY=<masked>` to `~/.zshenv` (zsh) or
  `~/.bashrc` (bash) — pick based on `$SHELL`.
- Skip persistence (key only available in current session).

Confirm the choice before writing. If user declines persistence, warn that
scheduled runs will fail unless the key is in env at MCP launch. Never put
the key in `.claap-config.json`. Never echo the key after capture.

**3. Detect the Notion MCP.**

Look for `mcp__claude_ai_Notion__notion-fetch` or `mcp__notion__notion-fetch`.
If neither is loaded, halt with:

> "Notion MCP isn't loaded. Connect the claude.ai Notion connector
> (Settings → Connectors) **or** add `mcp.notion.com` to your `.mcp.json`,
> then restart Claude Code and re-run me."

Record which prefix worked under `notion_tool_prefix` (the skill assumes
the same `notion-*` tool names suffix on both).

**4. Ask for the Notion parent page.**

"Paste the Notion URL or UUID of the page where the GTM Action Items DB
should live."

Resolve via `notion-fetch` to validate it exists and is writable. If
resolution fails, ask again. Persist nothing yet — only the resolved
page_id is used in step 8.

**5. Ask which signals to extract.**

"Which signals should I extract from transcripts? Press Enter for the
default 5, or paste a comma-separated list."

Default: `objection, competitor_mention, feature_request, action_item,
next_step_promised`.

Persist under `extraction_signals`.

**6. Ask for Kanban column names.**

"Which Kanban columns do you want? Press Enter for the default
(`Backlog`, `Focus This Week`, `Done`, `Archived`) or paste a
comma-separated list."

If the user supplies custom columns, ask for a color per column (must be
one of: `default, gray, brown, orange, yellow, green, blue, purple, pink,
red`). Persist column **names** under `kanban_statuses`.

**7. Ask for extra properties (optional).**

"Any extra properties on top of the default 10? Press Enter to skip, or
paste lines like `Owner: rich_text` / `Priority: select(High:red, Med:yellow,
Low:gray)`."

Persist under `extra_properties` as an array of `{name, type, options?}`.

**8. Create the database.**

Build a `notion-create-database` body following the contract in
`references/notion-db-schema.md`. Parameterize:
- `parent.page_id` ← the resolved page from step 4
- `Status` options ← `kanban_statuses` (color per user input, default
  mapping when defaults are used)
- Add any `extra_properties` to the `initial_data_source.properties` map

**Do not** use pseudo-SQL. The JSON body in `references/notion-db-schema.md`
is the only valid input shape.

On success, capture:
- The DB URL → `notion_db_url`
- The `data_source` UUID → `gtm_action_items_data_source_id`
  (store as `collection://<uuid>` for stability)

**9. Discover property IDs and create the Kanban view.**

Call `notion-fetch` on the new data source. From the response, extract
`property_id` for `Status`, `Title`, `Type`, `Deal / Lead`, `Verbatim
Quote`, `Claap Link`, `Source Call Date`, `Week`, `Surfaced By`, `Due`.

Call `notion-create-view` with the board configuration in
`references/notion-db-schema.md`, grouped by Status, showing the properties
above.

**10. Slack delivery.**

"How should I deliver the weekly Slack summary?"

Offer three modes:

a. **DM to a Slack user** — ask for the user ID. If the user provides a
   handle or name instead, resolve via `slack_search_users` (record the
   resolved `U...` ID). Persist as `slack_delivery: { mode: "mcp_user",
   target: "<U_YOUR_SLACK_ID>" }`.

b. **Post to a Slack channel** — ask for the channel ID (or resolve from
   name via `slack_search_channels`). Persist as `slack_delivery: { mode:
   "mcp_channel", target: "<C_YOUR_CHANNEL_ID>" }`.

c. **Incoming webhook** — instruct the user to create an incoming webhook
   in Slack and **export it as an env var**:

   ```
   export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
   ```

   Offer to append `export SLACK_WEBHOOK_URL=<masked>` to the user's
   `~/.zshenv` (zsh) or `~/.bashrc` (bash). Confirm before writing. Never
   echo the URL back in chat after capture. Persist as `slack_delivery: {
   mode: "webhook", target: "env:SLACK_WEBHOOK_URL" }`. The literal URL is
   **never** written to config.

**11. Write `.claap-config.json`.**

Persist all collected non-secret fields to
`.claude/skills/claap-weekly-recap/.claap-config.json` (the skill folder's
`.gitignore` already excludes this file).

Final shape:

```json
{
  "version": 1,
  "claap_tool_prefix": "<mcp__claap__ or mcp__claude_ai_Claap__>",
  "notion_tool_prefix": "<mcp__claude_ai_Notion__ or mcp__notion__>",
  "gtm_action_items_data_source_id": "collection://<YOUR_DATA_SOURCE_UUID>",
  "notion_db_url": "https://www.notion.so/<workspace>/<db-id>",
  "slack_delivery": { "mode": "...", "target": "..." },
  "lookback_days": 7,
  "min_call_minutes": 3,
  "extraction_signals": ["objection", "competitor_mention", "feature_request", "action_item", "next_step_promised"],
  "kanban_statuses": ["Backlog", "Focus This Week", "Done", "Archived"],
  "extra_properties": [],
  "prior_recap_history_path": "~/.gtm-os/state/claap-recap-history.md",
  "model": "claude-sonnet-4-6",
  "max_turns": 100
}
```

Print: **"Setup complete. Run me again to generate this week's recap."**

Do not proceed to the weekly run in the same session. The schedule infra
needs the persisted config; running once and exiting cleanly catches mis-
configurations before they hit production.

---

### NORMAL MODE (weekly run — config present)

Load `.claap-config.json`. Substitute `{{claap_tool_prefix}}` with the
config value in every reference below before calling the tool. (E.g. for
`{{claap_tool_prefix}}list_workspaces`, call `mcp__claap__list_workspaces`
or `mcp__claude_ai_Claap__list_workspaces`.)

#### Inputs

| Input | Source | Description |
|---|---|---|
| `gtm_action_items_data_source_id` | config | Notion DS ID (`collection://...` or bare UUID) |
| `slack_delivery` | config | Resolved Slack target |
| `week_label` | runtime (default current ISO week) | e.g. `2026-W20` |
| `lookback_days` | config (default 7) | Days of call history to scan |
| `prior_recap_history_path` | config | Path to history markdown |

#### Tools Used

**Claap MCP (read).** Claap exposes 7 tools under the `claap_tool_prefix`.
The four relevant ones:

| Tool | Required params | Use |
|---|---|---|
| `{{claap_tool_prefix}}list_workspaces` | — | Call first. Returns `workspaces[]`. Cache the primary `workspaceId`. |
| `{{claap_tool_prefix}}get_recordings` | `workspaceId` | Returns recording metadata. Filter with `filters.createdAt.gte/lte` (ISO date). Paginate via `nextCursor`. |
| `{{claap_tool_prefix}}get_recording_transcript` | `recordingId`, `workspaceId` | Full transcript for one recording. |
| `{{claap_tool_prefix}}search_recording_transcripts` | `search.query`, `search.type`, `workspaceId` | Cross-recording keyword / semantic search. |

`{{claap_tool_prefix}}search_companies`, `search_contacts`, `search_deals`
are available if you need to resolve participants → deals when the
recording doesn't carry a `dealId`.

**Notion (write).**
- `notion-fetch` on the target DS to confirm the schema and discover the
  current select option set.
- `notion-fetch` (with filter) to check for **existing pages this week**
  before creating new ones (idempotency guard — Step 6).
- `notion-create-pages` to add cards (batch ≤40 per call).
- `notion-update-data-source` to seed missing select options (always
  include `{ "id": "<existing-id>" }` entries for options you want to
  keep — see `references/notion-db-schema.md`).

**Slack (notify).**

Pick the path that matches `slack_delivery.mode` in config:

- `mcp_user` → `slack_send_message` with `channel_id =
  slack_delivery.target` (the user ID; Slack treats DMs that way).
- `mcp_channel` → `slack_send_message` with `channel_id =
  slack_delivery.target`.
- `webhook` → resolve env var named in `target` (e.g. `SLACK_WEBHOOK_URL`)
  via `Bash`. If the env var is empty, hard-stop with a clear error. Then
  POST the message body using the **temp-file pattern** (never use
  process substitution `<(...)` — fragile in cron / launchd / `claude -p`
  shells):

  ```bash
  printf '{"text": %s}' "$(jq -Rs . < /tmp/recap-body.txt)" > /tmp/recap.json
  curl -X POST -H 'Content-Type: application/json' \
    --data-binary @/tmp/recap.json "$SLACK_WEBHOOK_URL"
  ```

If the configured delivery mode can't be resolved (env var missing, MCP
not loaded), hard-stop. Do not silently skip the notification.

#### Step 1 — Pull the week's calls

1. `{{claap_tool_prefix}}list_workspaces` → cache `workspaceId`.
2. Compute date range: `today - lookback_days` → `today` as ISO `YYYY-MM-DD`.
3. `{{claap_tool_prefix}}get_recordings` with `{ workspaceId, filters: { createdAt: { gte, lte } } }`. Paginate.
4. For each: `{{claap_tool_prefix}}get_recording_transcript`. Skip calls under `min_call_minutes` (default 3).
5. From each transcript, extract moments by scanning for the signals listed in `extraction_signals`.

For each call retain: `recordingId`, `recordingTitle`, `createdAt`,
recording URL, participants, `dealId` / `companyId` if available, and the
extracted moments.

#### Step 2 — Cluster per deal

Group recordings by `dealId` (preferred) or `companyId` (fallback). When
neither is available, group by company name extracted from the external
participants list.

#### Step 3 — Extract action items

For each deal, propose 1–3 concrete action items. Each must:

- Be a clear next step (specific enough to act on without re-reading the transcript)
- Cite a **verbatim quote** from the transcript (10–25 words)
- Include a `claap_timestamp_url` pointing to the exact moment
- Default `Status = <first kanban_status>` (typically "Backlog")
- Carry the `Week` label

Skip generic items ("follow up"). Every card must answer "what specifically,
with whom, by when if known."

#### Step 4 — Synthesize focus blocks

Across all calls of the week, identify 2–4 themes worth a deep-work block
next week. A focus block is a *pattern*, not a single deal:

- "Tighten pricing objection rebuttal" — surfaced 6× across 4 deals
- "Compliance questions — no canonical answer yet" — surfaced 3× this week

Each must:
- 4–8 word title
- Cite underlying calls (count + which deals)
- `Type = Focus Block`, `Status = Focus This Week` (or the second
  `kanban_statuses` entry if the user customized them)
- Empty `Deal / Lead` (spans deals)

#### Step 5 — Carry-over check

If `prior_recap_history_path` is provided and the file exists, parse it
exactly this way:

1. Read the file as text.
2. Take the **last line whose ISO week label is different from
   `week_label`**. (The file may have multiple appends in one week if the
   skill was re-run; we want the last *previous* week.)
3. Split that line on the first colon. Left of the colon is the week
   label (e.g. `2026-W19`). Right of the colon is a pipe-separated list
   of focus block titles.
4. Normalize each title with `lowercase + strip leading/trailing whitespace`.
5. Compare title-by-title against this week's focus block titles
   (normalized the same way) using exact string match.

For each prior title:
- Match in this week → "still surfacing — was X deals last week, Y this
  week, widening/narrowing"
- No match → "resolved or no longer surfacing"

If the file doesn't exist, skip this step. No carry-over on first run.

#### Step 6 — Write to Notion (with idempotency guard)

**Before creating any pages**, run an idempotency check.

a. `notion-fetch` the DS with a filter:

```json
{
  "data_source_id": "<gtm_action_items_data_source_id>",
  "filter": {
    "property": "Week",
    "rich_text": { "equals": "<week_label>" }
  }
}
```

b. Build a set of "fingerprints" from the existing pages:
   - For Action Items: `Claap Link` URL (preferred) **or**
     `Verbatim Quote` normalized text if URL is empty.
   - For Focus Blocks: lowercased `Title`.

c. As you walk the cards you intend to create, drop any whose fingerprint
   already exists in the set. Log how many duplicates were skipped.

d. If **all** cards would be duplicates (typical second run in the same
   week), skip the Notion write entirely and reuse the existing
   `notion_db_url` view in the Slack summary.

Otherwise: `notion-create-pages` with the surviving cards, batched ≤40
per call. Property payload follows the JSON in
`references/notion-db-schema.md`.

If a select value (e.g. a custom `Type` or `Status`) isn't in the current
option set, use `notion-update-data-source` to add it. **Always include
`{ "id": "<existing-id>" }` entries for every existing option you want to
keep** — Notion treats the options array as authoritative; omissions
delete the option and orphan tagged pages.

#### Step 7 — Compose + send Slack summary

Plain text, no markdown beyond `*bold*`. Pattern:

```
Sunday recap — Week of <Mon DD>

<N> action items across <M> deals → <Notion Kanban URL>
<K> focus blocks for next week:
  · <title 1> (<count> deals)
  · <title 2> (<count> deals)
  · <title 3> (<count> deals)

Carry-over from last week:
  · <theme>: <status>
```

Send via the path matching `slack_delivery.mode`. One message per run.

#### Step 8 — Append to memory

Append this week's focus block titles to `prior_recap_history_path` so
next week's run can detect carry-over. **One line per run**, pipe-separated:

```
2026-W20: Pricing objection rebuttal | Compliance questions | Champion ID
```

If the file doesn't exist, create it with the single header line:

```
# Claap Weekly Recap — Focus Block History
```

If Step 6 short-circuited because every card was a duplicate, **still
append a history line** so re-runs are observable. The carry-over parser
explicitly skips lines whose week label equals the current `week_label`.

## Output Quality Bar

- **Specificity** — every action item names a person/deal and a concrete next step
- **Evidence** — every card carries a verbatim quote + Claap timestamp link
- **Honesty** — if the week had 2 calls, don't invent 8 action items
- **Brevity** — action item titles ≤ 12 words; focus block titles ≤ 8 words
- **Continuity** — carry-over check is mandatory when a history file is provided
- **Idempotency** — running twice in one week must not double-create cards

If the week had **zero calls**, send a single Slack message: "No calls
recorded this week. Skipping recap." Do not create Notion cards.

## Failure Modes — Hard Stops

Stop and report (no mocks, no partial output) if:

- Claap MCP returns auth error → check `CLAAP_API_KEY` in env at MCP-launch
  time, restart Claude Code session
- `notion-fetch` returns no DS at `gtm_action_items_data_source_id` → wrong
  DS ID, or workspace permissions
- Slack delivery resolution fails (env var missing, MCP not loaded)
- DNS / network failure

For a transient single-call fetch failure: skip that call, log it, continue
with the rest.

See `references/troubleshooting.md` for the full list with remedies.

## Sample Outputs

See `references/sample-output.md` for a real run's action items, focus
blocks, and Slack DM.

## Running on a Schedule

Pick the option that matches your environment. Options B, C, and D are the
documented primary paths — Option A only applies if you're already running
the Yalc agent stack and won't work if you downloaded this skill folder
standalone.

### Option B — macOS launchd (native)

Primary path on macOS. See `scripts/run.sh.template` and
`scripts/launchd.plist.template`. Copy, fill in placeholders, install via
`launchctl load`. Full step-by-step in `references/setup.md`.

### Option C — Linux cron

Cron line example in `scripts/cron-example.txt`. Use the same
`scripts/run.sh.template` wrapper.

### Option D — Linux systemd timer

systemd timer template at `scripts/systemd.timer.template`.

### Option A — Yalc-stack only (skip if you only have this skill folder)

If — and only if — you have the Yalc OSS agent system installed
(`~/Desktop/gtm-os/` with the agent CLI), you can register a cross-platform
schedule:

```yaml
# configs/agents/claap-weekly-recap.yaml
id: claap-weekly-recap
schedule:
  type: weekly
  weekday: sunday
  hour: 8
  minute: 0
steps:
  - skillId: claap-weekly-recap
```

Install: `npx tsx src/cli/index.ts agent:install --agent claap-weekly-recap`.

This path **requires the broader Yalc agent runtime** and won't function if
you only cloned this skill folder.
