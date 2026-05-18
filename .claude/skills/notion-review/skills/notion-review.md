# Notion Review Surface — Procedure (v3: inline per-batch items)

End-to-end workflow for human-in-the-loop verification of YALC outputs in Notion.

**Shape (one per output type):**
- ONE Batches kanban — each card = one batch (e.g. one lead list per campaign).
- Click into a batch card → a Leads table renders **inline inside the page body** with every item in that batch. No extra click, no navigation.
- The inline table has a `Status` column per row. Every row defaults to **Qualified**. User flips bad rows to **Removed** (kill-list pattern). Then drags the batch card from "To Review" → "Approved" with one drag.
- Downstream consumes every row from every Approved batch whose Status is not "Removed".

## When to use

- The user wants a review queue for one of YALC's verifiable outputs (qualified leads, qualified visitors, qualified engagers, lead-magnet replies, content drafts).
- The user wants to **reconfigure** an existing surface (change category name, gate mode).
- A registered Batches DB was deleted/archived and needs recreating.

**Don't use when:**
- The output type isn't on the supported list. Mention "Extending the registry" below and stop.

## Supported output types (v3)

| Output type | Default category | Batch card columns (kanban) | Item columns (inline table) |
|---|---|---|---|
| `qualified_lead` | "Qualified Leads" | Campaign, Lead Count, Created Date, ICP Segment | Company, Title, LinkedIn URL, Qualification Score, Reasoning |
| `qualified_visitor` | "Qualified Visitors" | Source, Visit Count, Created Date | Company, Title, Source URL, Visit Date, Qualification Score, Reasoning |
| `qualified_engager` | "Qualified Engagers" | Post Topic, Post URL, Engager Count, Created Date | Company, Engagement Type, Engagement Date, ICP Match Score, Reasoning |
| `lead_magnet_reply` | "Lead Magnet Replies" | Magnet Topic, Reply Count, Created Date | Company, Reply Text, Reply Date |
| `content_draft` | "Content Drafts" | Theme, Draft Count, Created Date | Channel, Hook, Body Excerpt |

**Two separate status state machines:**
- **Batch-level Status** on the kanban: `To Review` (default) → `Approved` / `Rejected`. Drives the gate.
- **Item-level Status** in each inline table: `Qualified` (default for every new row) / `Removed`. Drives the kill list.

**Load-bearing contract** (added automatically; user cannot opt out):
- Batches DB: `Title` (title), `Status` (select), `Batch ID` (rich_text), `Items DB ID` (rich_text).
- Each per-batch items DB (created at push time): `Title` (title), `Item ID` (rich_text), `Status` (select).

## The 5-phase flow

Always follow this order.

---

### Phase 1 — Pre-flight (FREE)

1. Confirm `NOTION_API_KEY` is set. If missing, surface the error verbatim and stop.
2. Check `~/.gtm-os/notion-reviews.yaml` for an existing surface for the chosen output type.
   - If present and the user said "set up": offer "Reconfigure (change name / gate mode — same DB) or rebuild (create a new Batches DB)?" Default: reconfigure.
   - If present and the user said "reconfigure": jump straight to Phase 3 with prior answers preloaded.
   - If absent: continue to Phase 2.

---

### Phase 2 — Resolve parent Notion page (FREE)

Ask where the new Batches DB should live in Notion. Accept:
- A Notion page URL (extract the 32-char ID).
- A raw 32-char or dashed-UUID page ID.
- A page **title** — use `notionService.search(query, { property: 'object', value: 'page' })`. If multiple matches, warn and pick the first.

Don't use MCP for page resolution. Use `src/lib/services/notion.ts`.

---

### Phase 3 — Setup questions (conversational, ONCE per output type)

Asked the first time and on `review:reconfigure`. NOT asked when a new batch is pushed.

**Q1. Output type / category** — qualified_lead / qualified_visitor / qualified_engager / lead_magnet_reply / content_draft.

**Q2. Parent Notion page** (already resolved in Phase 2 — confirm).

**Q3. Category display name** — default = `defaults.displayName`. The user can rename.

**Q4. Batch card columns (kanban metadata)** — defaults shown per type. User can add/remove/rename.

**Q5. Item columns (inline table inside each card)** — defaults shown per type. User can add/remove/rename. The template is applied to every per-batch inline table at push time.

**Q6. Gate mode** — `hard` (default; YALC halts and waits for Approval) or `autonomous` (YALC pushes to Notion AND continues — Notion is FYI only).

Summarize answers in one block. Confirm before any Notion writes happen.

---

### Phase 4 — Create the Batches DB (1 Notion write)

`npx tsx src/cli/index.ts review:setup --output-type <t> --parent-page-id <id> --category-name "<name>" --mode <hard|autonomous>`

Or invoke `setupReviewSurface(args)` programmatically when the column lists are non-default (the CLI flags can't express arbitrary column arrays).

Under the hood (`src/lib/services/notion-reviews.ts`):
1. `setupReviewSurface` calls `notionService.createDatabase` ONCE for the Batches DB.
2. The full config (parent page, category name, gate mode, batch columns, item columns template, batch DB ID) is written to `~/.gtm-os/notion-reviews.yaml`.
3. Surface the URL.

No items DB is created at setup time. Items DBs are created lazily, one per batch, at push time — see Phase 5b.

---

### Phase 5 — Add Kanban + Gallery views on the Batches DB (REQUIRED)

The Notion REST API only creates the default Table view. Use the Notion MCP — **only this skill uses MCP, only for view creation:**

1. `mcp__claude_ai_Notion__notion-create-view` on the Batches DB → **Kanban grouped by `Status`**, displaying Title + the user's batch columns.
2. `mcp__claude_ai_Notion__notion-create-view` on the Batches DB → **Gallery** view, displaying Title + key batch columns.

If MCP fails (unauthorized, rate-limited), surface verbatim and offer to retry. Don't swallow.

---

### Phase 5b — How push actually works (no user action needed)

The producer side (e.g. `qualify-leads.ts` calling `applyReviewGate('qualified_lead', batchMeta, items)`) does:

1. Creates a new batch row in the Batches DB at Status="To Review".
2. Creates a new **inline child database** ("Leads") inside that batch's page (`is_inline: true`). This is what makes the items table render directly in the card body.
3. Updates the batch row to stamp the new items DB's ID into the `Items DB ID` property.
4. Creates one row in the per-batch items DB for each item, defaulting Status="Qualified".

Read side (`getApprovedBatches(outputType)`):
1. Query Batches DB for `Status = Approved`.
2. For each approved batch, read its `Items DB ID` property, query that DB.
3. Return every row whose Status is not "Removed".

---

### Phase 6 — Push backlog (optional)

If the user has prior batches sitting elsewhere, offer to push them now via `pushBatchToReviewSurface(outputType, batchMeta, items)`. One call per batch. Show counts (`pushed=X failed=Y`).

---

## Reconfigure

`review:reconfigure --output-type <t>` walks Phase 3 with prior answers preloaded. Changes category name / gate mode only. Column changes are YAML-only in v3 — adding a column applies to **future batches**; old batches keep their original schema. This is intentional: old approved batches stay frozen.

## Verify (the safety net)

`review:doctor --output-type <t>` calls `verifyReviewSurface(outputType)` and prints:
- ✅ all four load-bearing properties present on Batches DB → safe.
- ⚠️ a contract property is renamed/missing/wrong type → exact fix instruction.
- ℹ️ user-added columns → listed transparently, not flagged.

Per-batch items DBs are NOT pre-verified (they're created on push).

## Gate toggling

- `review:gate --output-type qualified_lead --mode autonomous` — trust YALC, push only for FYI.
- `review:gate --output-type qualified_lead --mode hard` — turn the gate back on.

Updates YAML in place. No DB changes.

Producer-side behaviour:
- **no surface registered** → behave as today (act immediately).
- **registered + `hard`** → push as one batch + items, return `pushed-halt`. Producer event tells the user to approve in Notion.
- **registered + `autonomous`** → push as one batch + items, return `pushed-continue`. Producer continues.

## Status command

`review:status` lists all registered surfaces with parent page, batch DB ID, gate mode.

## Failure modes

| Symptom | Cause | What the skill does |
|---|---|---|
| `NOTION_API_KEY must be set` | Env var missing | Surface verbatim, stop. |
| Notion 404 on Batches DB retrieve | User deleted the DB | `verifyReviewSurface` reports it; prompt to re-run `review:setup`. |
| Notion 429 during push | Rate limit | `pushBatchToReviewSurface` retries each item once with a 2s backoff. |
| Parent page archived | User archived parent | `databases.create` fails — surface the error, ask for a new parent. |
| MCP view-create fails | MCP plugin unavailable/unauthorized | Surface verbatim. The DB still works in Table view; user can add Kanban manually. |

## Extending the registry

Five built-in output types live in `src/lib/services/notion-reviews.ts` (`BUILTIN_DEFAULTS`). To add a new one, call `registerOutputTypeDefaults({ outputType, displayName, batchTitleTemplate, batchDefaults, itemDefaults })` from a startup hook. The four batch contract properties + the three item contract properties are added automatically — don't redeclare them. `batchTitleTemplate` uses `{Column Name}` tokens replaced from `batchMeta` at push time.

## Done when

- One Batches DB created in Notion under the chosen parent.
- Mapping committed to `~/.gtm-os/notion-reviews.yaml`.
- Kanban + Gallery views added via MCP on the Batches DB.
- User understands: open a batch card → inline Leads table → flip rows to "Removed" → drag batch to "Approved".
- User understands the four CLI verbs: `review:setup`, `review:reconfigure`, `review:gate`, `review:doctor`, `review:status`.
