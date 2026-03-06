# Day 3 Report — Tables, Execution Engine & RLHF Intelligence

**Date:** March 5, 2026
**Build status:** `pnpm build` passes with 0 TypeScript errors
**Files created:** 27 new files + 1 interactive mockup
**Files modified:** 7 existing files

---

## What Was Built

### Phase 1: Execution Engine + Table UI + Chat Integration

**Backend:**
- `src/lib/ai/types.ts` — Added `ColumnType`, `ColumnDef`, `ExecutionEventType`, `ExecutionEvent` types
- `src/lib/execution/columns.ts` — Maps step types + providers to column definitions. `buildColumnsFromSteps()` deduplicates and merges columns across all workflow steps
- `src/lib/execution/mock-engine.ts` — Claude-powered mock data generator using `tool_choice: { type: 'tool', name: 'generate_leads' }`. Generates leads in batches of 10 with intentional quality distribution (~30% great / ~40% okay / ~30% poor ICP fits)
- `src/app/api/workflows/execute/route.ts` — SSE streaming endpoint. Creates workflow + resultSet + workflowSteps in DB, runs mock engine per step, streams `execution_start`, `step_start`, `row_batch`, `step_complete`, `execution_complete` events
- `src/app/api/tables/route.ts` — GET: list all tables with feedback stats
- `src/app/api/tables/[id]/route.ts` — GET: table metadata + rows. DELETE: cascade delete
- `src/app/api/tables/[id]/rows/[rowId]/feedback/route.ts` — PATCH: set feedback/annotation/tags

**Atoms:**
- `src/atoms/table.ts` — 8 primitive atoms + 3 derived atoms (filteredRowsAtom applies filter + search + sort, feedbackStatsAtom counts, allSelectedAtom)
- `src/atoms/conversation.ts` — Added `ExecutionState` interface + `executionStateAtom`

**Table Page (9 components):**
- `TableView` — Orchestrator: fetches data, manages keyboard shortcuts (j/k navigate, a/r/f set feedback), connects all sub-components
- `TableHeader` — Name, row count badge, feedback progress bar (matcha/pomegranate/tangerine segments), "Done Reviewing" button (disabled until 5 approved + 5 rejected)
- `TableToolbar` — Filter pills with counts, search input, bulk approve/reject, row count display
- `TableGrid` — Custom Tailwind `<table>`, sticky `<thead>`, horizontal scroll, sticky-right RLHF column
- `TableRow` — Checkbox + row index + data cells + FeedbackActions. Visual states for approved (green left border), rejected (red + opacity), flagged (orange), selected (blueberry bg), focused (ring)
- `TableCell` — Typed renderer: text (truncate+tooltip), number (right-aligned tabular-nums), url (domain+external arrow), badge (color-cycled pills via hash), score (mini progress bar with green/yellow/red thresholds)
- `TableColumnHeader` — Sort indicator, click cycles asc → desc → none
- `FeedbackActions` — Three SVG icon buttons (check/X/flag) with color states, toggle behavior

**Chat Integration:**
- `ExecutionProgressCard` — Shows in chat during execution. Step list with status icons (grey dot / blueberry pulse / matcha check / pomegranate X). Progress bar
- `TableLinkCard` — Renders when `message.type === 'table'`. Shows table name, row/column counts, mini 3-row preview, "View Table →" link
- `ChatPanel.tsx` — Replaced the Day 1 stub `handleApproveWorkflow` with full SSE execution: reads stream events, updates `executionStateAtom`, pushes a `table` message on completion
- `MessageBubble.tsx` — Added rendering branch for `type === 'table'` → TableLinkCard
- `MessageList.tsx` — Added ExecutionProgressCard when execution is running
- `Sidebar.tsx` — Added "Tables" nav item (matcha accent, grid SVG icon, between Chat and Knowledge Base). Updated day counter to "Day 3 of 30"
- `globals.css` — Added `.row-feedback-enter` animation and `.row-rejected` style

### Phase 2: API Keys Vault

- `src/app/api/api-keys/route.ts` — GET: list providers (NEVER returns encryptedKey). POST: encrypt via AES-256-GCM, upsert
- `src/app/api/api-keys/[provider]/route.ts` — DELETE: remove key. POST: validate format (real health checks later)
- `src/atoms/apiKeys.ts` — `connectedProvidersAtom`, `apiKeysLoadingAtom`
- `src/components/api-keys/ApiKeysView.tsx` — Grid of 6 provider cards (Apollo, Firecrawl, Hunter, Clearbit, BuiltWith, OpenAI). Expandable forms with password input, test/remove buttons, confirm dialogs. Status badges (Connected=matcha, Not Connected=muted, Expired=pomegranate)
- `src/app/api-keys/page.tsx` — Same layout pattern as chat page
- `Sidebar.tsx` — API Keys `comingSoon: false`
- `mock-engine.ts` — Added `checkProviderKey()`: checks apiConnections before generating, logs key detection status

### Phase 3: RLHF Intelligence Loop

- `src/lib/execution/learning-extractor.ts` — Takes approved/rejected/flagged rows + columns, builds side-by-side comparison prompt, calls Claude with `extract_learnings` tool. Uses QUALIFIER_MODEL (Opus) for deeper pattern recognition. Returns `{ insight, confidence, segment, evidence_count }[]`
- `src/app/api/tables/[id]/learn/route.ts` — POST: runs learning extractor, returns patterns for user review (does NOT auto-save). Requires minimum 5 approved + 5 rejected
- `src/app/api/tables/[id]/learn/confirm/route.ts` — POST: converts confirmed patterns to `Learning` objects, appends to `framework.learnings[]`, saves to DB
- `src/components/table/LearningsPanel.tsx` — Full-screen overlay (bg-black/50 backdrop-blur). Stats bar, staggered pattern cards with Confirm/Not quite/Edit actions, inline text editing, "Save All & Close" CTA
- `TableView.tsx` — Wired "Done Reviewing" → POST /learn → open LearningsPanel
- `TableHeader.tsx` — "Done Reviewing" calls learn endpoint, shows loading state

---

## Decisions Made

1. **Mock engine generates batches of 10** — Keeps Claude responses manageable. 5 batches = 50 rows total. Each batch is a separate API call to avoid timeout issues

2. **Quality distribution is prompt-enforced** — Rather than post-processing, the prompt instructs Claude to generate ~30/40/30 ICP fit distribution. This is simpler and Claude follows it well

3. **Keyboard shortcuts on table** — j/k/a/r/f pattern mirrors Vim and popular data review tools. Only fires when not in an input field

4. **Optimistic UI for feedback** — Local state updates immediately, API call fires in background. Feels instant

5. **Badge colors use hash** — `hashString()` maps any string to a deterministic color index. Same value always gets same color — no randomness

6. **Score thresholds: >70 green, 40-70 yellow, <40 red** — Standard ICP scoring convention

7. **Learning extractor uses QUALIFIER_MODEL** — The brief specifies Opus for deeper pattern recognition. Falls back to Sonnet if Opus isn't available

8. **LearningsPanel doesn't auto-save** — User reviews each pattern before confirming. Dismissed patterns are discarded. Edited patterns get saved with the edited text

---

## Route Map After Day 3

```
Pages:
  /              → redirect to /chat
  /chat          → Chat + onboarding (Day 2)
  /tables/[id]   → Lead grid with RLHF controls (Day 3)
  /api-keys      → API keys vault (Day 3)

API Routes:
  POST   /api/chat                              → Chat + workflow proposals
  GET    /api/framework                         → Current framework
  POST   /api/onboarding/extract                → SSE framework extraction
  POST   /api/onboarding/questions              → Follow-up questions
  POST   /api/onboarding/complete               → Save framework
  POST   /api/workflows/execute                 → SSE workflow execution
  GET    /api/tables                            → List tables + stats
  GET    /api/tables/[id]                       → Table data
  DELETE /api/tables/[id]                       → Delete table
  PATCH  /api/tables/[id]/rows/[rowId]/feedback → Set row feedback
  POST   /api/tables/[id]/learn                 → Extract patterns from feedback
  POST   /api/tables/[id]/learn/confirm         → Save confirmed learnings
  GET    /api/api-keys                          → List connected providers
  POST   /api/api-keys                          → Add/update API key
  POST   /api/api-keys/[provider]               → Test connection
  DELETE /api/api-keys/[provider]               → Remove key
```

---

## Phase 4: Interactive Mockup + Signal Qualification UI

**File:** `public/mockup.html` (~1300 lines, self-contained static HTML)

This is the design prototype for the table view — a fully interactive, standalone HTML page that runs inside the Next.js dev server. No React, no build step. Pure HTML/CSS/JS with the exact design language the real components will follow.

**What it demonstrates:**
- 15 US SaaS companies with realistic enrichment data (Stripe, Notion, Figma, Linear, etc.)
- Flat design system: Space Mono headings + Inter body, Yalc color tokens (matcha/pomegranate/tangerine/blueberry/grape/peach)
- Full keyboard-driven review: j/k navigate, a/r/f for feedback, s for signals, Esc to close panels
- Filter pills (All/Pending/Approved/Rejected/Flagged) with live counts
- Floating chat bar at the bottom (matches the chat page aesthetic)

**Signal Qualification Column (the key addition):**
- Every lead has 5-7 typed signals explaining its ICP score
- 10 signal types: hiring, funding, techStack, growth, icp, intent, role, timing, market, negative
- Each signal has a label (human-readable explanation) and a weight (+/- N points)
- Signal cell in the table shows a clickable button with signal count
- Clicking opens a slide-out panel (right-side drawer with backdrop blur)
- Panel groups signals into "Positive Signals" and "Negative Signals" sections
- Each signal card shows: type icon (SVG), type label, explanation text, weighted score (green/red)
- High-score leads (Stripe 94, Notion 91) have mostly positive signals; low-score leads (ClickFunnels 14, Typefully 18) have mostly negative — the distribution makes RLHF meaningful

**Column order (optimized):** #, Company, ICP Score, Signals, Website, Industry, Employees, City, Title, Email, Review

The ICP Score and Signals columns sit immediately after Company name — the most decision-relevant data is front and center. The reviewer's eye goes: company → score → why → decision.

**Design philosophy:** "Every score has a receipt." No black-box scoring. The signal column makes the AI's reasoning transparent and auditable. This is also the training data for the RLHF loop — when a user rejects a lead with strong positive signals, that disagreement is the most valuable learning signal.

---

## Flags for Review

1. **No `tables` list page** — `/tables` (without ID) has no page. The Sidebar "Tables" link goes to `/tables` which will 404. Consider: should Day 4 add a tables list page, or should the link go to `/chat` with a different tab?

2. **Execution creates a fresh conversation ID** — If no `conversationId` exists yet (user clicks "Run" before the chat API assigns one), the execute endpoint receives `'default'`. The workflow row references this conversation. Should handle more gracefully

3. **No real API key validation** — The "Test Connection" button only validates encrypted format. Real provider health checks need to be added when providers are integrated

4. **LearningsPanel uses `&apos;` for apostrophes** — React JSX requirement. Renders correctly in browser

5. **No streaming for mock engine** — Each batch of 10 is a full Claude API call. Total 50 rows = 5 calls. With ~3-5s per call, execution takes 15-25s. Could parallelize batches in the future

6. **Mockup is static HTML** — The mockup demonstrates the full interaction model but isn't wired to the API. The React components in `src/components/table/` are the real implementation. The mockup serves as the design spec and demo artifact
