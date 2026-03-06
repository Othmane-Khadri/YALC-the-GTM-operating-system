# Day 2 Report — GTM Framework Architecture + Onboarding + Chat Overhaul

**Date:** March 4, 2026
**Build status:** `pnpm build` passes with zero TypeScript errors

---

## What Was Built

### Part 1: GTM Framework Architecture
- **`src/lib/framework/types.ts`** — Full GTMFramework type system: company identity, positioning (value prop, differentiators, competitors), ICP segments (each with voice, messaging, content strategy), channels, buying signals, objection library, campaign learnings
- **`src/lib/framework/context.ts`** — `buildFrameworkContext()` that serializes the framework into a readable prompt section. Token-aware: picks primary segment, summarizes last 5 validated learnings, doesn't dump raw JSON
- **`src/lib/framework/template.ts`** — `createEmptyFramework()` factory with sensible defaults
- **`src/lib/db/schema.ts`** — Added `frameworks` table (id, userId, data as JSON, onboardingStep, onboardingComplete, timestamps)
- **`src/lib/ai/workflow-planner.ts`** — Added `frameworkContext` parameter to `buildSystemPrompt()`, injected between step types and knowledge base sections
- **`src/app/api/chat/route.ts`** — Fetches framework on each request, passes to prompt builder
- **`src/lib/skills/`** — Placeholder folder with types.ts, registry.ts, README.md

### Part 2: Onboarding Popup
- **5 Jotai atoms** in `src/atoms/onboarding.ts` — open state, step index, collected data, processing state, questions
- **4 API endpoints:**
  - `GET /api/framework` — Returns current framework or null
  - `POST /api/onboarding/extract` — SSE streaming endpoint that fetches website, combines with uploaded docs, calls Claude Sonnet with tool calling to extract a structured GTMFramework
  - `POST /api/onboarding/questions` — Analyzes framework gaps, generates 3-5 Claude-powered follow-up questions
  - `POST /api/onboarding/complete` — Saves framework to DB, marks onboarding complete
- **10 components:**
  - `OnboardingModal.tsx` — Full-screen overlay with backdrop blur, step orchestrator
  - `WelcomeStep.tsx` — Website URL (required) + LinkedIn URL (optional)
  - `UploadStep.tsx` — Drag-and-drop document upload with file list
  - `ProcessingStep.tsx` — SSE-connected status messages, auto-advances on completion
  - `ReviewStep.tsx` — Editable framework display with collapsible sections
  - `QuestionsStep.tsx` — Conversational follow-up, one question at a time
  - `StepIndicator.tsx` — 5-dot progress indicator
  - `FileDropZone.tsx` — Drag-and-drop component (PDF, MD, TXT, DOCX)
  - `FrameworkEditor.tsx` — Inline field editing + tag inputs for arrays
- **`src/app/chat/page.tsx`** — On mount, checks for framework via `/api/framework`. Opens onboarding modal if no framework exists.

### Part 3: CLAUDE.md Rewrite
- 12-section comprehensive reference: Product Identity, Tech Stack, Architecture, Framework System, Database Schema, API Patterns, Provider System, RLHF, Skills, Onboarding, UI Conventions, File Map, Conventions
- ~250 lines, dense and scannable

### Part 4: Premium Visual Overhaul (All Components)

**Foundational Changes:**
- **globals.css** — Selection highlight → `blueberry-50`, body `font-size: 14px`, `text-rendering: optimizeLegibility`, `letter-spacing: -0.01em`, scrollbar → 5px rounded, message-enter → 0.3s ease-out, added `fade-in-up` animation for staggered status messages, added `modal-enter` animation with scale+translate
- **tailwind.config.ts** — Added missing color shades: `matcha-50`, `dragonfruit-50/600`, `tangerine-50/700`, `lemon-50`

**Chat Components:**
- **ChatInput.tsx** — `rounded-2xl` container, `shadow-sm`, `px-5 py-4` (was `px-4 py-3`), `surface-3` bg, send button → 40px `rounded-xl` with SVG arrow icon + hover scale, char counter removed entirely
- **MessageBubble.tsx** — Assistant messages → transparent bg with minimal padding `px-1 py-2` (open text flow, not boxed), user bubbles → `rounded-[20px_20px_6px_20px]`, `px-5 py-3.5`
- **MessageList.tsx** — Wordmark 60px (was 64px, tighter), `-0.04em` tracking, action cards → `rounded-2xl p-6`, icon containers → 48x48px `rounded-xl` with inline SVG icons (replaced Unicode), cards hover → `translateY(-2px)` + shadow, `surface-3` bg, streaming/thinking indicators → transparent bg (no box)
- **WorkflowPreviewCard.tsx** — `rounded-2xl` (was `rounded-xl`), `max-w-[672px]`, header `pt-6 pb-4`, title → `text-base` (was `text-sm`), step numbers → 28px `rounded-lg` (was 24px `rounded-md`), CTA → `px-6 py-3` with hover bg transition, time badge → `rounded-lg` with more padding

**Sidebar:**
- **Sidebar.tsx** — Replaced all Unicode icons (⬡ ◎ ◈ ◆ ⬟ ◇) with crisp inline SVGs (grid, speech bubble, book, key, puzzle, gear), logo box → 32px `rounded-xl` (was 28px `rounded-lg`), nav items → `rounded-xl gap-3 py-2.5` (was `rounded-lg gap-2.5 py-2`), icon containers → 28px (was 24px), active indicator → `rounded-full` (was square), SOON badges → `rounded-md px-2` (was `rounded-[3px] px-1.5`), label → 13px (was 12px), hover bg on non-active items, collapse toggle → `rounded-xl` with SVG chevrons

**Onboarding Components:**
- **OnboardingModal.tsx** — `rounded-3xl shadow-2xl` (was `rounded-2xl shadow-xl`), `padding: 48px` (was 40px), backdrop `blur(12px) opacity-0.5` (was `blur(8px) opacity-0.4`), `modal-enter` animation with scale
- **StepIndicator.tsx** — Active dot → `32px` wide (was 24px), dots → `8px` (same), `mb-10` (was `mb-8`)
- **WelcomeStep.tsx** — Labels → `uppercase tracking-[0.06em]` + `text-secondary` color, inputs → `rounded-xl py-3.5 surface-3` bg, field spacing → `space-y-5` (was 4), button → `py-3.5 mt-10` (was `py-3 mt-8`), LinkedIn field → "Your LinkedIn profile" (personal, not company)
- **UploadStep.tsx** — Button spacing → `mt-10` (was `mt-8`), `py-3.5`, skip button simplified
- **FileDropZone.tsx** — `rounded-2xl border-2 dashed` with `border-subtle` (was border), `p-12` (was `p-10`), icon → 36px, drag-over → `blueberry-600` border + subtle blueberry bg tint, file cards → `rounded-xl px-4 py-3` with hover effect on remove
- **ProcessingStep.tsx** — Status messages → `fade-in-up` animation with staggered `animationDelay`, error state → soft red bg with border instead of solid `pomegranate-600` fill, pulse dot → 10px (was 16px)
- **ReviewStep.tsx** — Button → `py-3.5 mt-8` (was `py-3 mt-6`)
- **FrameworkEditor.tsx** — `max-h-[60vh]` scroll area (was 400px), section headers → `text-base font-bold` with `▸/▾` chevrons (was `▲/▼`), section bg → `surface` when open, fields → `uppercase tracking-[0.06em]` labels + `px-3.5 py-2.5 rounded-lg`, tags → `rounded-full` pills (was `rounded-md`), focus → blueberry border, competitor cards → `rounded-xl p-4` with border
- **QuestionsStep.tsx** — Progress bar added (blueberry fill on border track), question text → `text-base leading-relaxed` (was `text-sm font-bold`), select options → `rounded-xl p-5 surface-3` cards (was `rounded-lg p-4`), skip remaining → underlined text link (was bordered button), `fade-in-up` animation on question transitions

---

## Framework Schema Decisions

1. **`channels.preferences` is `Partial<Record<ChannelType, ChannelConfig>>`** — not every channel needs config at onboarding, so partial keeps it flexible
2. **`Learning.confidence` has 3 levels** — hypothesis → validated → proven. Only validated+ learnings appear in the prompt context to avoid noise
3. **Context builder picks only the primary segment** — to keep token usage reasonable. Secondary segments listed briefly by name only
4. **Framework stored as JSON blob** — not normalized tables. This is intentional: the framework is read as a unit and updated as a unit, so JSON is more practical than 10 relational tables

## Onboarding UX Decisions

1. **Website extraction via basic fetch + tag stripping** — not Firecrawl. Keeps dependencies minimal. If fetch fails (CORS, auth), processing continues with whatever docs were uploaded
2. **Claude tool calling for extraction** — uses `tool_choice: { type: 'tool', name: 'extract_framework' }` to force structured output. The tool schema matches a subset of GTMFramework
3. **File reading is client-side** — `FileReader.readAsText()`. Simple, no server upload needed. PDF/DOCX give best-effort text extraction
4. **Questions step is optional** — users can skip remaining questions and complete setup anytime
5. **SSE for extraction** — status messages stream in real-time, giving the user feedback during the 15-30 second wait

## Visual Design Decisions

- **Body font-size 14px (was 13px)**: Space Mono is a monospace font — it needs 14px minimum to be comfortably readable. The 1px increase makes a disproportionate difference in monospace
- **Assistant messages are transparent, not boxed**: User bubbles are dark containers. Assistant text is open-flow — no background, no border. This asymmetry creates clear visual hierarchy and makes the conversation feel like you're talking to an intelligent system, not exchanging equal chat bubbles
- **SVG icons replace Unicode geometric shapes**: Unicode chars like ⬡ ◎ ◈ render inconsistently across OS/browser. Custom SVGs render pixel-perfect at every size and match the brand's precision aesthetic
- **Modal entrance animation with scale**: `scale(0.97) → scale(1)` creates a subtle "emerging" feel that makes the onboarding feel intentional and premium
- **Questions step has progress bar**: A thin blueberry progress track gives spatial context ("I'm on question 2 of 4") without the bulk of a numbered progress indicator
- **Tag pills → rounded-full**: Pill-shaped tags (fully rounded) feel more polished than `rounded-md` rectangles. They also visually separate from input fields which use `rounded-lg`
- **Surface-3 for input backgrounds**: Using the warmest white (`#FEFDFB`) for input fields creates a subtle elevation above the oat background while staying warmer than pure white

## For Review

- The onboarding extraction depends on the website being publicly fetchable (no auth, no heavy JS rendering). If your website requires JavaScript to render content, the extraction will get minimal data. Future improvement: use Firecrawl for proper rendering
- Screenshots were not captured (would require running dev server + browser automation). Visual changes can be verified with `pnpm dev`

## Commit Plan (for when you push to GitHub)

Stage and commit in this order:
1. `feat: GTM framework architecture + context system (Day 2)` — framework/, skills/, schema.ts, workflow-planner.ts, chat/route.ts
2. `feat: onboarding popup — AI-powered company context builder (Day 2)` — onboarding atoms, API endpoints, 10 components, chat/page.tsx
3. `feat: premium visual overhaul — all components (Day 2)` — globals.css, tailwind.config.ts, 4 chat components, Sidebar.tsx, 10 onboarding components, CLAUDE.md

## Files Modified in Visual Overhaul (14 files)

| File | Key Changes |
|------|-------------|
| `globals.css` | Selection, text-rendering, animations, scrollbar |
| `tailwind.config.ts` | Missing color shades added |
| `ChatInput.tsx` | rounded-2xl, shadow-sm, 40px SVG send button |
| `MessageBubble.tsx` | Assistant → transparent, user → refined radius |
| `MessageList.tsx` | 60px wordmark, SVG card icons, hover lift |
| `WorkflowPreviewCard.tsx` | rounded-2xl, 28px steps, bigger CTA |
| `Sidebar.tsx` | SVG icons, rounded-xl nav, 32px logo |
| `OnboardingModal.tsx` | rounded-3xl, shadow-2xl, 48px padding |
| `StepIndicator.tsx` | 32px active dot, 8px dots |
| `WelcomeStep.tsx` | Uppercase labels, rounded-xl inputs |
| `UploadStep.tsx` | Spacious buttons, simplified skip |
| `FileDropZone.tsx` | rounded-2xl, bigger drop zone, hover effects |
| `ProcessingStep.tsx` | Staggered fade-in, soft error state |
| `ReviewStep.tsx` | More breathing room |
| `FrameworkEditor.tsx` | 60vh scroll, rounded-full tags, chevrons |
| `QuestionsStep.tsx` | Progress bar, card-style selects, text link skip |
