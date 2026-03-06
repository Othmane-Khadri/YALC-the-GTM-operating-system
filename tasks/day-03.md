# Day 3 — Tables, Execution Engine & RLHF Intelligence

**Date:** March 5, 2026
**Author:** CTO (Claude)
**The feature:** When a user asks to start an outreach campaign, the system creates a lead database, populates it with mock data via Claude, lets the user qualify leads with RLHF (approve/reject/flag), extracts learning patterns from the feedback, and stores them so every future interaction gets smarter.

**Build in 3 phases. Each phase is independently demoable. Read the full brief, then execute phase by phase.**

---

## Read These Files First (Every Phase)

1. `src/lib/db/schema.ts` — resultSets + resultRows + workflows + workflowSteps tables (your data layer)
2. `src/lib/ai/workflow-planner.ts` — Pattern for Claude tool definitions (you'll mirror this)
3. `src/app/api/onboarding/extract/route.ts` — Reference SSE streaming + Claude tool_choice pattern
4. `src/components/chat/ChatPanel.tsx` — handleApproveWorkflow stub you'll replace
5. `src/lib/ai/types.ts` — Types you'll extend
6. `src/components/chat/WorkflowPreviewCard.tsx` — Card style to match for new cards

---

## Phase 1: Backend + Execution Engine + Table UI + Chat Integration

### What you're building

The full loop: user approves a workflow in chat → mock execution generates realistic leads → chat shows a link to the table → user opens `/tables/[id]` → full data grid with RLHF controls.

### New files

**Execution engine:**

`src/lib/execution/mock-engine.ts`
- Claude-powered mock data generator using Sonnet
- Uses `tool_choice: { type: 'tool' }` with a `generate_leads` tool definition (mirror the `propose_workflow` tool pattern in `workflow-planner.ts`)
- Generates leads in batches of 10 based on campaign context + user's ICP from the framework
- **Critical:** Intentionally generate ~30% great ICP fits, ~40% okay, ~30% poor fits — this makes RLHF meaningful
- Streams rows via SSE events

`src/lib/execution/columns.ts`
- Maps step types + providers to default column definitions:
  - **search** → company_name (text), website (url), industry (badge), employee_count (number), location (text), description (text)
  - **enrich by provider** → apollo: email/phone/linkedin_url/title; firecrawl: tech_stack/seo_score; builtwith: technologies/cms; hunter: email_verified/confidence
  - **qualify** → icp_score (score, 0-100) + qualification_reason (text)

**API routes:**

`src/app/api/workflows/execute/route.ts`
- POST, SSE streaming endpoint
- Creates workflow row (status: 'running') + resultSet + workflowSteps in DB
- Runs mock engine step by step
- SSE event types: `execution_start` (workflowId, resultSetId), `step_start` (stepIndex, title), `row_batch` (rows[], totalSoFar), `step_complete` (stepIndex, rowsOut), `execution_complete` (resultSetId, totalRows)
- Follow the exact SSE pattern from `src/app/api/onboarding/extract/route.ts`

`src/app/api/tables/route.ts`
- GET: list all tables with row counts + feedback stats (approved/rejected/flagged/pending counts)

`src/app/api/tables/[id]/route.ts`
- GET: table metadata (resultSet) + all rows (resultRows)
- DELETE: remove table (cascades via FK)

`src/app/api/tables/[id]/rows/[rowId]/feedback/route.ts`
- PATCH: set feedback ('approved'|'rejected'|'flagged'|null), annotation (string), tags (string[])

**Table page + components:**

`src/atoms/table.ts`
- `activeTableMetaAtom` — { id, name, workflowId, columns: ColumnDef[], rowCount, createdAt } | null
- `tableRowsAtom` — Array<{ id, rowIndex, data: Record<string, unknown>, feedback, tags, annotation }>
- `tableLoadingAtom` — boolean
- `feedbackFilterAtom` — 'all' | 'pending' | 'approved' | 'rejected' | 'flagged'
- `tableSearchAtom` — string (client-side text filter)
- `tableSortAtom` — { key: string, dir: 'asc' | 'desc' } | null
- `selectedRowIdsAtom` — Set<string>
- `focusedRowIndexAtom` — number
- Derived: `filteredRowsAtom` (applies filter + search + sort), `feedbackStatsAtom` (counts), `allSelectedAtom` (boolean)

`src/app/tables/[id]/page.tsx`
- Same layout as `/chat/page.tsx`: JotaiProvider > div.flex.h-screen > Sidebar(activeItem="tables") > TableView

`src/components/table/TableView.tsx`
- Fetches data on mount (GET /api/tables/[id]), populates atoms
- Renders: TableHeader → TableToolbar → TableGrid
- Keyboard shortcuts: j/k navigate rows, a/r/f set feedback on focused row

`src/components/table/TableHeader.tsx`
- Table name, row count badge, feedback progress bar (horizontal bar with matcha/pomegranate/tangerine/border segments), "Done Reviewing" button (disabled until 5 approved + 5 rejected — wire in Phase 3), "Back to chat" link

`src/components/table/TableToolbar.tsx`
- Filter pills: All | Pending | Approved | Rejected | Flagged
- Search input (filters by any text column client-side)
- Bulk actions when rows selected: Approve All, Reject All
- Row count: "23 of 50 rows"

`src/components/table/TableGrid.tsx`
- Custom Tailwind `<table>`, NO external library
- Sticky `<thead>` (bg-surface, border-b)
- Horizontal scroll wrapper (overflow-x-auto)
- Fixed-right RLHF actions column (position: sticky, right: 0)
- Column widths: text min-w-[180px], number min-w-[100px], url min-w-[200px], badge/score min-w-[120px]

`src/components/table/TableRow.tsx`
- Checkbox + row index + data cells + FeedbackActions
- Visual states:
  - Default: bg-white
  - Hover: bg-surface
  - Selected: bg-blueberry-50
  - Approved: left-border-[3px] matcha-600
  - Rejected: left-border-[3px] pomegranate-600 + opacity-60
  - Flagged: left-border-[3px] tangerine-600
  - Focused (keyboard): ring-2 ring-blueberry-600

`src/components/table/TableCell.tsx`
- Typed renderer:
  - **text**: truncate with title tooltip on hover
  - **number**: right-aligned (Space Mono is already monospace)
  - **url**: clickable link showing domain only + external arrow icon
  - **badge**: colored pill. Hash the value to cycle through blueberry/matcha/tangerine/dragonfruit/lemon
  - **score**: mini progress bar 0-100. Green (matcha) >70, yellow (tangerine) 40-70, red (pomegranate) <40

`src/components/table/TableColumnHeader.tsx`
- Column label + sort indicator (▲/▼/none). Click cycles asc → desc → none.

`src/components/table/FeedbackActions.tsx`
- Three 24x24 icon buttons (SVG, no Unicode):
  - Approve: checkmark, matcha-600 when active, text-muted when inactive
  - Reject: X icon, pomegranate-600 when active
  - Flag: flag icon, tangerine-600 when active
- Clicking active feedback sets to null (undo)

**Chat integration components:**

`src/components/table/TableLinkCard.tsx`
- Renders in chat when `message.type === 'table'`
- Shows: table name, row count, column count, mini 3-row preview, "View Table →" button
- Same card style as WorkflowPreviewCard (rounded-2xl, border, shadow)

`src/components/table/ExecutionProgressCard.tsx`
- Shows in chat while execution runs
- Lists steps with status icons (pending=grey dot, running=blueberry pulse, done=matcha check, failed=pomegranate X)
- Current step: "Generating row 23 of 50..." with progress
- Morphs into TableLinkCard on completion

### Existing files to modify

- `src/lib/ai/types.ts` — Add `ColumnType = 'text'|'number'|'url'|'badge'|'score'`. Add execution event types. Extend StreamEvent.
- `src/atoms/conversation.ts` — Add `executionStateAtom`
- `src/components/chat/ChatPanel.tsx` — Replace `handleApproveWorkflow` stub with real execution
- `src/components/chat/MessageBubble.tsx` — Add table message rendering
- `src/components/layout/Sidebar.tsx` — Add "Tables" nav item (matcha accent, grid SVG icon, comingSoon: false). Position between Chat and Knowledge Base.
- `src/app/globals.css` — Add `.row-feedback-enter` animation and `.row-rejected` style

### Verify Phase 1
1. `pnpm dev`, chat → "Find 50 SaaS companies in France hiring for sales roles"
2. Workflow proposed → click "Run this workflow" → progress card shows in chat
3. Completion → TableLinkCard appears → click "View Table →"
4. `/tables/[id]` renders full grid with realistic leads
5. Approve/reject/flag rows → visual states + filter works
6. `pnpm build` clean

### Commit
`feat: table execution engine + lead grid with RLHF controls (Day 3)`

---

## Phase 2: API Keys Page

### What you're building

The `/api-keys` page where users securely manage their API keys. The existing `apiConnections` table + `crypto.ts` encryption are already built — you're adding the UI and API routes.

### New files

`src/app/api-keys/page.tsx`
- Same layout: JotaiProvider > Sidebar(activeItem="api-keys") > ApiKeysView

`src/components/api-keys/ApiKeysView.tsx`
- Grid of provider cards (Apollo, Firecrawl, Hunter, Clearbit, BuiltWith, OpenAI)
- Each card: provider icon (SVG), name, status badge:
  - Connected: matcha pill "Connected"
  - Not connected: text-muted pill "Not Connected"
  - Expired: pomegranate pill "Expired"
- Expandable form: password-type input for the key (never show stored key)
- "Test Connection" button (validates format for now)
- "Remove" button (pomegranate, with confirm dialog)
- Use `encrypt()` / `decrypt()` from `src/lib/crypto.ts`

`src/app/api/api-keys/route.ts`
- GET: list from `apiConnections` — return provider, status, lastTestedAt. **NEVER return the encrypted key.**
- POST: add/update — encrypt key, upsert into apiConnections

`src/app/api/api-keys/[provider]/route.ts`
- DELETE: remove key from DB
- POST (path: test): validate key format (real health checks come later)

`src/atoms/apiKeys.ts`
- `connectedProvidersAtom` — string[]
- `apiKeysLoadingAtom` — boolean

### Existing files to modify

- `src/components/layout/Sidebar.tsx` — Change API Keys: `comingSoon: false`
- `src/lib/execution/mock-engine.ts` — Before executing a step, check `apiConnections` for the provider. If key exists: log "ready for real integration (using mock for now)". If not: log "no key, generating mock data".

### Verify Phase 2
1. Navigate to `/api-keys`
2. Add Apollo key → shows "Connected"
3. Test → success
4. Remove → back to "Not Connected"
5. Run a workflow → logs show key detection
6. `pnpm build` clean

### Commit
`feat: API keys vault with encrypted storage (Day 3)`

---

## Phase 3: RLHF Intelligence Loop

### What you're building

The intelligence layer: derive patterns from feedback, present conclusions to the user, store learnings that influence every future conversation.

### How it works

1. User reviews leads → approves/rejects/flags rows
2. Clicks "Done Reviewing" (minimum: 5 approved + 5 rejected)
3. POST /api/tables/[id]/learn → Claude receives approved vs. rejected rows side by side
4. Claude extracts patterns via `extract_learnings` tool:
   - "Companies under 50 employees were consistently rejected"
   - "SaaS companies with React in their tech stack were consistently approved"
5. LearningsPanel overlay shows pattern cards with Confirm / Not quite / Edit actions
6. User confirms → POST /api/tables/[id]/learn/confirm → patterns saved to `framework.learnings[]` with `source: 'rlhf'`
7. Next conversation: `buildFrameworkContext()` already injects learnings into Claude's system prompt

### New files

`src/lib/execution/learning-extractor.ts`
- Takes approved/rejected/flagged rows + column definitions
- Builds prompt showing Claude both groups side by side
- Uses `extract_learnings` tool (structured output) → `Array<{ insight, confidence: 'hypothesis'|'validated'|'proven', segment?, evidence_count }>`
- Use QUALIFIER model (Opus if available, Sonnet fallback) for deeper pattern recognition

`src/app/api/tables/[id]/learn/route.ts`
- POST: runs learning extractor, returns patterns for user review
- Does NOT auto-save
- Response: `{ patterns: Pattern[], stats: { approved, rejected, flagged, total } }`

`src/app/api/tables/[id]/learn/confirm/route.ts`
- POST: receives confirmed patterns, converts to Learning objects, appends to `framework.learnings[]`, saves framework to DB
- Response: `{ saved: number, frameworkUpdated: true }`

`src/components/table/LearningsPanel.tsx`
- Full-screen overlay (same backdrop as OnboardingModal: bg-black/50 backdrop-blur)
- Summary header: "I reviewed [N] leads. Here's what I learned:"
- Stats bar: approved/rejected/flagged counts with color-coded segments
- Pattern cards stagger in with fadeInUp animation (same as ProcessingStep):
  - Insight text
  - Confidence badge: hypothesis (blueberry), validated (matcha), proven (matcha bold)
  - Evidence count: "based on 12 leads"
  - Segment tag if applicable
  - Actions: "Confirm" / "Not quite" / "Edit" (inline text edit)
- Footer: "Save All & Close" primary CTA + "Dismiss" secondary link
- After save: brief success toast/indicator before closing

### Existing files to modify

- `src/components/table/TableHeader.tsx` — Wire "Done Reviewing" button: call POST /api/tables/[id]/learn, then open LearningsPanel with returned patterns
- `src/components/table/TableView.tsx` — Add state for LearningsPanel visibility + patterns data. Render `<LearningsPanel>` conditionally.

### Verify Phase 3
1. Open table with 50 leads. Approve ~15, reject ~15, flag ~3
2. "Done Reviewing" → loading while Claude analyzes
3. LearningsPanel opens with 3-5 pattern cards
4. Patterns are specific and accurate
5. Confirm 3, dismiss 1, edit 1 → "Save All"
6. New chat → type similar query → Claude references the learnings
7. `pnpm build` clean

### Commit
`feat: RLHF intelligence loop — learn from feedback, get smarter (Day 3)`

---

## Design Constraints (All Phases)

- **No external table library** — custom Tailwind grid
- **Space Mono everywhere** — monospace is great for data tables
- **Colors:** matcha = approved/success, pomegranate = rejected/error, tangerine = flagged/warning, blueberry = selected/active
- **Use `cn()` from `src/lib/utils.ts`** for conditional classes
- **Use `input-focus` class** for form inputs
- **SSE streaming** — ReadableStream → TextEncoder → `data: {json}\n\n` (same as chat and onboarding)
- **Follow the frontend-design skill** for all new UI
- **Use SVG icons** (not Unicode) — same as the rest of the codebase
