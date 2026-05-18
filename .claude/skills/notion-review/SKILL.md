---
name: notion-review
description: "Set up a Notion verification surface so YALC outputs (qualified leads, qualified visitors, qualified engagers, lead-magnet replies, content drafts) land in a kanban that you approve in Notion before downstream skills act on them. Each output type has ONE Batches kanban — every card is a batch (e.g. one lead list per campaign). Clicking a card opens its page with an INLINE Leads table rendered directly in the body (no extra click). Every item defaults to Status='Qualified'; users mark bad rows as 'Removed' (kill list), then drag the batch from To Review → Approved with one drag. Supports per-user-configured columns. Registers config in ~/.gtm-os/notion-reviews.yaml. Toggles the gate between hard (halt until approved) and autonomous (push + continue). Use when someone says 'set up a review kanban for [output type]', 'create a Notion review surface', 'I want to verify [output type] in Notion', 'let me approve qualified leads before YALC acts on them', 'reconfigure my review kanban', 'turn on Notion verification', 'trust YALC to act on engagers autonomously', or 'turn the verification gate back on for engagers'."
---

# Notion Review Surface

Execute the procedure in `skills/notion-review.md`.

The setup is a conversational flow asked ONCE per output type (not per batch / not per campaign).

Required inputs:
1. **Output type** — one of `qualified_lead`, `qualified_visitor`, `qualified_engager`, `lead_magnet_reply`, `content_draft`.
2. **Parent Notion page** — URL, page ID, or page title.

Then configuration questions about category name, batch card columns, inline-table columns, and gate mode. Defaults shown — user can accept them and skip.

Optional flags:
- `--rebuild` — force a new Batches DB even if one is registered. Default: reconfigure existing.
- `--mode <hard|autonomous>` — for `review:gate`.

Hard rules:
- **Two separate status state machines.** Batch-level on the kanban: `To Review` → `Approved` / `Rejected` (the gate signal). Item-level inside each card's inline table: `Qualified` (default) / `Removed` (kill list).
- **Inline child databases.** When a batch is pushed, an inline items DB (`is_inline: true`) is created inside that batch's page — items render directly in the card body, no navigation.
- **Per-batch items DBs.** There is NO global items DB. Each batch owns its own items DB. Clean separation between campaigns; YALC reads back through `getApprovedBatches`.
- **Load-bearing contract:**
  - Batches DB: `Title`, `Status`, `Batch ID`, `Items DB ID` (the last is plumbing — stamped at push time so the read path can locate the items DB).
  - Per-batch items DB: `Title`, `Item ID`, `Status`.
  These are added automatically. Everything else is user-configurable.
- **Hybrid Notion access:** DB + page creation, queries, updates go through `src/lib/services/notion.ts`. Kanban + Gallery view creation uses the Notion MCP (`mcp__claude_ai_Notion__notion-create-view`) — only place in this skill where MCP is used.
- Runtime config lives at `~/.gtm-os/notion-reviews.yaml`. Never edit by hand — use `review:setup`, `review:reconfigure`, `review:gate`, `review:doctor`.

This skill is tenant-agnostic. Config is global (not per-tenant) in v3.
