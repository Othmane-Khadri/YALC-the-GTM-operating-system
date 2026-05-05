---
name: icp-import
description: "Translate a client's Notion ICP doc into YALC framework files for a tenant. Reads the Notion page (any structure), maps content flexibly into the 9 canonical YALC sections (framework.yaml, icp/segments.yaml, qualification_rules.md, voice/, positioning/, search_queries.txt, campaign_templates.yaml, company_context.yaml), parks unmappable content in notes.md, and lands everything in _preview/ for review and commit. Use when someone says 'import ICP for X', 'populate framework from Notion', 'sync ICP from Notion for <tenant>', or 'pull ICP into YALC'."
---

# Import ICP from Notion into a YALC Tenant

Execute the procedure in `skills/icp-import.md`.

Read that file now and follow every step in order. Required inputs (ask if not provided):

1. **Tenant slug** (e.g. `datascalehr`) — kebab-case, used for the directory under `~/.gtm-os/tenants/`
2. **Notion page URL or ID** — the client's ICP doc (the source of truth)

Optional:
- `--sync` — re-run mode. Compares the Notion doc against the existing live framework and only regenerates sections whose source changed.
- `--dry-run` — generate to a temp directory and show diff without writing to `_preview/`.

The skill is conversational. Walk the user through fetch → mapping preview → write to `_preview/` → review handoff. Never commit on the user's behalf — always end by telling them to run `yalc-gtm start --commit-preview --tenant <slug>` after they've reviewed.
