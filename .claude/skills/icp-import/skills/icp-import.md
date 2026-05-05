# YALC GTM-OS — ICP Import Procedure

This is the long-form runbook for the `/icp-import` skill. It translates a client's Notion ICP doc into the YALC framework files for a tenant. Walk the user through every step, in order. Each numbered step is one conversational beat.

## Hard rules (apply to the whole flow)

- **Never write directly to `~/.gtm-os/tenants/<slug>/<live-file>`.** All output goes to `~/.gtm-os/tenants/<slug>/_preview/` and the user commits via `yalc-gtm start --commit-preview --tenant <slug>`. Per `CLAUDE.md`: runtime context modifications must go through the preview/commit flow.
- **Never paste API keys or secrets into chat.** If you read `~/.gtm-os/.env`, mask values.
- **Never push to git.** This skill only writes local YALC files.
- **Never upload preview files to external hosts by default.** ICP docs contain internal team names, named exclusions (real partners/competitors), live campaign IDs, and other client-sensitive content. The preview is local-only unless the user explicitly asks to share it externally and confirms the audience.
- **Mapping is fuzzy by design.** Notion docs vary per client. Do not require any specific section to exist. Map what's there; park the rest in `notes.md`. Never invent ICP content the source doc doesn't support.
- **Tier 1 routing rule (datascalehr-style):** if the source doc designates one or more "tier" definitions, surface them in `qualification_rules.md` under a `## Tiering` heading. Do not silently drop tiers.

---

## Step 1 — Collect inputs

You need:

1. **Tenant slug** — kebab-case (e.g. `datascalehr`, `acme-co`). This becomes the directory name under `~/.gtm-os/tenants/`.
2. **Notion page URL or ID** — the ICP doc.

If either is missing, ask the user. Don't guess the slug from the doc title (the user owns the slug — it has to match across tools).

If the user gave a flag like `--sync` or `--dry-run`, note it for later steps.

---

## Step 2 — Verify the tenant directory

Check whether the tenant already exists:

```bash
ls -la ~/.gtm-os/tenants/<slug>/ 2>&1 | head -20
```

Three cases:

- **Doesn't exist** → fresh import. Create the directory: `mkdir -p ~/.gtm-os/tenants/<slug>/_preview`. Tell the user this is a new tenant.
- **Exists, no live framework.yaml** → first-time ICP import for an existing scaffold. Proceed.
- **Exists with a live framework.yaml** → this is a sync. Read the existing live files first (Step 5 will diff against them).

Also check for an existing `_preview/` directory — if one is present, ask the user whether to discard it (they may have an in-progress preview from `yalc-gtm start`). Don't overwrite without confirmation.

---

## Step 3 — Fetch the Notion ICP doc

Use the Notion MCP fetch tool:

```
mcp__claude_ai_Notion__notion-fetch
  id: <Notion URL or page ID provided by user>
```

If the fetch fails (auth, 404, permissions), stop and report the exact error. Do not proceed with a partial doc.

Save the raw doc text in your working memory for the rest of the procedure. You'll reference it many times.

---

## Step 4 — Read the source doc and produce a mapping plan

This is the core of the skill. Read the full Notion content, then produce a section-by-section mapping plan that the user can review before files get written.

For each canonical YALC section below, decide:
- **Source content** — which parts of the Notion doc feed it (quote headings/excerpts so the user can verify).
- **Confidence** — high / medium / low / none. "None" means skip the file entirely.
- **Notes** — any judgment calls, ambiguities, or content that doesn't fit cleanly.

Canonical sections (must consider all of them, but skip whichever the doc doesn't support):

| Section | Live file(s) | Typical Notion sources |
|---|---|---|
| `framework` | `framework.yaml` | Whole doc; high-level positioning, segments, signals, exclusions, personas |
| `icp` | `icp/segments.yaml` | "Segments" / "Personas" / "Customer types" / "Tiers" |
| `qualification_rules` | `qualification_rules.md` | "Hard criteria" / "Disqualifiers" / "Exclusions" / "Tiering" / scoring rules |
| `voice` | `voice/tone-of-voice.md`, `voice/examples.md` | "Tone" / "Voice" / "How we talk" / sample messages. **Skip if doc has no voice content** — never invent a voice. |
| `positioning` | `positioning/one-pager.md`, `positioning/battlecards/<competitor>.md` | "Core ICP" / "Value prop" / "Differentiation" / explicit competitor sections |
| `search_queries` | `search_queries.txt` | "Bonus signals" / "Buying triggers" / "Monitoring keywords" — converted to search-friendly phrases |
| `campaign_templates` | `campaign_templates.yaml` | "Campaign templates" / "Sequence drafts" — **skip if absent**, do not invent |
| `company_context` | `company_context.yaml` | Doc owner, last-updated, source URL — metadata only |

Anything in the Notion doc that doesn't map (e.g. partnership routing rules, internal change logs, links to external tools) → goes into `_preview/notes.md` so nothing is lost.

**Show the mapping plan to the user as a table.** Wait for confirmation before writing files. The user may want to redirect specific content (e.g. "don't make a battlecard for X — they're a partner, not a competitor"). Treat redirects as normal input.

---

## Step 5 — Sync mode: diff before writing

Only relevant if the live tenant already has a framework. If `~/.gtm-os/tenants/<slug>/framework.yaml` exists:

1. Read the live files into memory.
2. Read the existing `_meta.json` (if present) to see when the Notion doc was last imported and what hash each section had.
3. Compute the diff per section: which sections in the live framework would change vs the new mapping.
4. Show the user a per-section change summary: `unchanged | minor edits | rewritten | new`.
5. Ask which sections to regenerate. Default: only sections where Notion content materially changed. Skip sections the user has manually edited since the last import (compare live hash vs `_meta.json.last_committed_hash`).

If the user opts to regenerate everything, treat it as a fresh import.

---

## Step 6 — Generate `_preview/` files

Write each section the user approved. File-by-file guidance:

### `framework.yaml`
Schema lives in [src/lib/framework/types.ts:5-57](../../../src/lib/framework/types.ts#L5-L57). Required top-level keys:

- `company` — name (from doc title or user input), website (if mentioned), description (one-line summary of who they sell to), industry (infer from content if obvious, else leave empty).
- `positioning.valueProp` — distill from the "Core ICP" or value-prop sections. One sentence. Use the doc's exact phrasing where possible.
- `positioning.competitors[]` — only if the doc names competitors with positioning info. Don't fabricate.
- `segments[]` — at least one. If the doc has multiple personas or campaign cuts, generate one segment per cut. Each segment needs `id`, `name`, `description`, `priority` (`primary` for the main one), `targetRoles`, `painPoints`, `disqualifiers`. Optional: `targetCompanySizes`, `targetIndustries`, `targetGeographies`, `keyDecisionMakers`, `buyingTriggers`, `voice`, `messaging`, `contentStrategy`. Leave optional fields off if the doc doesn't support them — don't placeholder.
- `signals.buyingIntentSignals[]`, `signals.triggerEvents[]`, `signals.monitoringKeywords[]` — extract from "Bonus signals" / "Buying triggers" sections.
- `objections[]` — only if the doc lists them. Empty array is fine.
- `notion_source` — **add this custom field**: `{ url, page_id, last_imported_at, last_edited_at }` so future syncs know where to look. (Tolerated by the schema — extras are preserved.)
- `onboardingComplete: true`, `version: '1.0'`, `lastUpdated: <today ISO date>`.

### `icp/segments.yaml`
One YAML doc with a top-level `segments` key. Mirror the segment structure from `framework.yaml` but with full per-segment voice/messaging/contentStrategy where the doc supports it. If `framework.yaml` already covers it, this file can be a thin re-export — many synthesis runs do exactly that.

### `qualification_rules.md`
A markdown doc structured as:

```markdown
# Qualification Rules — <Tenant Name>

Source: <Notion URL>  •  Last imported: <date>

## Hard criteria (must pass all)
<bulleted list, exact wording from doc>

## Hard exclusions (instant disqualify)
<bulleted list, with examples where the doc gives them>

## Bonus signals (score boosts, not gating)
<bulleted list>

## Tiering
<tier definitions if present, else omit this heading>

## Personas

### Primary outreach
<roles>

### Buyers (approval, low response rate)
<roles>

### Anti-personas (do not target)
<roles>
```

If the doc doesn't have one of these subsections, omit it (don't write empty headings).

### `voice/tone-of-voice.md` and `voice/examples.md`
Skip both if the Notion doc has no voice content. If it does, extract verbatim quotes where possible — voice is easy to get wrong via paraphrase.

### `positioning/one-pager.md`
A short one-pager: who they sell to, what the product does, the wedge. Distilled from "Core ICP" and any value-prop language. ~150-300 words.

### `positioning/battlecards/<competitor>.md`
Only if the doc names competitors with positioning content. One file per competitor. If the doc just lists competitor names without context, skip.

### `search_queries.txt`
One search query per line. Convert "bonus signals" to keyword phrases (e.g. "ADP customers for ≥4 years" → `"ADP" "payroll" tenure`). Aim for 10–30 queries.

### `campaign_templates.yaml`
**Skip if the doc has no template content.** Do not invent templates from segment data.

### `company_context.yaml`
Metadata only. Capture:
```yaml
company:
  name: <tenant display name>
  notion_doc: <URL>
sources:
  - type: notion
    url: <URL>
    page_id: <id>
    fetched_at: <ISO>
    last_edited_at: <from Notion if available>
```

### `notes.md` — write to LIVE root, not `_preview/`
Anything from the Notion doc that didn't map to a canonical section. Quote the original heading + content so the user can decide what to do with it later. Sections like "Change log", "How Yalc reads this page", partnership routing instructions, and links to other Notion pages typically land here.

**Critical path note:** write `notes.md` directly to `~/.gtm-os/tenants/<slug>/notes.md`, **NOT** to `_preview/notes.md`. YALC's `commitPreview()` only promotes files in [SECTION_NAMES](../../../src/lib/onboarding/preview.ts#L154-L164), and deletes everything else in `_preview/` after a successful commit. `notes.md` is not a YALC section, so a `_preview/notes.md` would be silently dropped on commit and the user would lose the content.

If a live `notes.md` already exists from a prior import, don't blow it away — read it, append a new dated section for this import, and write back. That preserves the audit trail across syncs.

### `_preview/_meta.json`
```json
{
  "skill": "icp-import",
  "tenant": "<slug>",
  "source": {
    "type": "notion",
    "url": "<URL>",
    "page_id": "<id>",
    "fetched_at": "<ISO>",
    "last_edited_at": "<from Notion if known>"
  },
  "sections": {
    "framework": { "confidence": "high", "source_hash": "<sha256 of relevant Notion sections>" },
    "icp": { "confidence": "high", "source_hash": "..." },
    ...
  },
  "skipped": ["voice", "campaign_templates"],
  "imported_at": "<ISO>"
}
```

The `source_hash` is what enables sync mode in Step 5 — recompute on re-run, only regenerate where it changed.

---

## Step 7 — Generate and open the local HTML preview (default)

After writing the canonical files in Step 6, generate a single self-contained HTML preview at `~/.gtm-os/tenants/<slug>/_preview/preview.html` and open it in the user's default browser. This is the default review surface.

Why HTML and not the YALC SPA: the SPA at `localhost:3847/setup/review` is a fine option but requires running `pnpm dev:web` first. The HTML preview works with zero setup, renders markdown nicely, and is **local-only** (`file://`) — no upload, no external host.

### Where to write the HTML preview

Write the file to `~/.gtm-os/tenants/<slug>/_imports/<YYYY-MM-DD>/preview.html`, **not** to `_preview/preview.html`. Same reason as `notes.md`: YALC's commit machinery deletes the entire `_preview/` directory after promoting canonical files, so anything written to `_preview/` that isn't a YALC section is lost on commit. The `_imports/` sibling directory is untouched by commit, so the HTML survives as an audit trail of what was imported on which date.

If `_imports/<YYYY-MM-DD>/` already exists (re-running on the same day), append a sequence suffix (`_imports/2026-05-04-2/preview.html`).

### Build the HTML

The HTML file should:

- Be self-contained: one file, no external deps except a single CDN call to `marked.min.js` for markdown rendering. Embed all content inline as text in `<script type="text/markdown">` blocks for markdown sections, and parsed/structured HTML for YAML sections (don't render YAML as raw — turn it into definition lists, tables, segment cards, pill lists).
- Use a clean tab/anchor navigation for the canonical sections that were written.
- Show a status banner at the top: tenant slug, source URL, last imported, files generated count, files skipped count, and a `Not committed` badge.
- Include a `Sections skipped (and why)` panel listing each skipped section with the reason.
- Include a footer with the exact commit commands (Step 8). Make it explicit that "commit" is local file movement and **does not touch git**.
- Avoid loading remote analytics, fonts, or images. The only outbound network call should be the marked.js script tag.

Use the datascalehr preview at `~/.gtm-os/tenants/datascalehr/_preview/preview.html` as the structural reference for layout, color palette, and component patterns (segment cards, pill lists, status banner, commit footer).

### Open it

```bash
open "$HOME/.gtm-os/tenants/<slug>/_preview/preview.html"
```

(macOS `open` opens `file://` paths in the default browser.)

### Then report

After opening, show the user:

1. **Preview URL** — `file:///Users/<user>/.gtm-os/tenants/<slug>/_preview/preview.html` (clickable in most terminals)
2. **Files written to `_preview/`** — full list with one-line summary each.
3. **Sections skipped** — and why.
4. **Content parked in `notes.md`** — bulleted summary.
5. **Confidence flags** — any medium/low-confidence sections the user should eyeball.
6. **Diff vs live** (sync mode only) — per-section change summary.

### Alternative review surfaces (offer only if asked)

- **YALC SPA** — `pnpm dev:web` from the repo root, then `http://localhost:3847/setup/review?tenant=<slug>`. Use this if the user wants inline editing (the SPA supports per-section save before commit).
- **External share** — only if the user explicitly asks to share the preview with a teammate AND confirms it's OK to upload client-sensitive content. Use the `here-now` skill on the `_preview/` folder. Default answer is no — point the teammate to the local file path or have them re-run the import on their machine instead.

---

## Step 8 — Hand off to commit

Tell the user exactly how to commit (after they've reviewed the HTML preview):

```bash
# Commit when ready (moves files from _preview/ → live tenant dir on this machine):
yalc-gtm start --commit-preview --tenant <slug>

# Or discard a specific section before committing:
yalc-gtm start --commit-preview --tenant <slug> --discard <section>
```

Make it clear in the message: "commit" here is local file movement on this machine. It does not touch git, does not push to the yalc-internal repo, and is invisible to anyone else.

**Do not commit on the user's behalf.** End the run after the handoff message.

---

## Step 9 — Save the source pointer for future syncs

The source URL is persisted in two places by Step 6 (`framework.yaml.notion_source` + `_preview/_meta.json`). On a future invocation, if the user says "sync ICP for `<slug>`" without giving a URL, you should:

1. Check `~/.gtm-os/tenants/<slug>/framework.yaml` for `notion_source.url`.
2. If present, use that URL as the source. Confirm with the user before fetching.
3. If absent, ask the user for the URL.

This is what makes `/icp-import <slug>` work without re-typing the URL each time.

---

## Edge cases

- **Notion doc references other Notion pages.** Don't fan out automatically. Note them in `notes.md` and let the user decide whether to import linked docs separately.
- **Doc has internal-only context** (e.g. "owned by Jerome, route via partnership track"). Park in `notes.md`. Never put internal team routing into runtime context files — campaigns will see it.
- **Doc contradicts the existing framework.** In sync mode, surface the contradiction explicitly. Default to the Notion doc as source of truth, but let the user override per section.
- **Multiple ICP segments with conflicting voice.** Per-segment voice goes in `icp/segments.yaml` under each segment. Top-level `voice/tone-of-voice.md` should reflect the dominant or shared voice — flag if there isn't one.
- **No company name in doc.** Use the tenant slug as a fallback display name. Ask the user to confirm before writing.
