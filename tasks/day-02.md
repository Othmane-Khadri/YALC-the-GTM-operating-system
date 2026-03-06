# Day 2 — GTM-OS Framework Architecture + Onboarding Popup + Chat Visual Overhaul

**Date:** March 4, 2026
**Author:** CTO (Claude)
**Developer:** You are building three things today: (1) the intelligence architecture that makes GTM-OS a personalized operating system, (2) the onboarding popup that populates it on first visit, and (3) a visual upgrade that makes the chat feel premium.

---

## Files to Read First

Read these in order before writing any code:

1. `CLAUDE.md` — current project rules (you'll be rewriting this)
2. `docs/DIRECTION.md` — full product vision and architecture brief
3. `docs/BRAND.md` — color system and design tokens
4. `src/lib/db/schema.ts` — current 8-table schema
5. `src/lib/ai/types.ts` — current TypeScript types
6. `src/lib/ai/workflow-planner.ts` — current system prompt builder
7. `src/app/api/chat/route.ts` — current streaming API endpoint
8. `src/components/chat/ChatPanel.tsx` — current chat orchestration
9. `src/components/chat/MessageList.tsx` — current empty state + message rendering
10. `src/components/chat/ChatInput.tsx` — current input area
11. `src/components/chat/MessageBubble.tsx` — current message bubbles
12. `src/components/chat/WorkflowPreviewCard.tsx` — current workflow cards
13. `tailwind.config.ts` — current design tokens

---

## Part 1: GTM-OS Framework Architecture

### What This Is

The Framework is the living intelligence layer of GTM-OS. When a user onboards, they drop their website URL, LinkedIn profile, and internal docs. The system scrapes, extracts, asks clarifying questions, and builds a structured context about their business. This context gets injected into every Claude interaction — every workflow proposal, every qualification, every enrichment step becomes personalized.

Think of it as a second brain that continuously evolves. Not just "find me leads" but "find me leads matching MY ICP, in MY channels, using MY voice, avoiding MY competitors' positioning."

Today you ship the architecture AND the onboarding experience — the types, the DB table, the context injection, and a multi-step onboarding popup that populates the framework on first visit.

### Requirements

#### 1. Create `src/lib/framework/types.ts`

Define the full GTM Framework schema. This is the master type that everything references:

```typescript
// The complete GTM context for a user's business
export interface GTMFramework {
  // ─── Company Identity ─────────────────────────────────────────
  company: {
    name: string
    website: string
    linkedinUrl: string
    industry: string
    subIndustry: string
    stage: 'pre-seed' | 'seed' | 'series-a' | 'series-b' | 'growth' | 'enterprise'
    description: string               // AI-generated summary from website + docs
    teamSize: string
    foundedYear: number
    headquarters: string
  }

  // ─── Positioning ──────────────────────────────────────────────
  positioning: {
    valueProp: string                  // One-sentence value proposition
    tagline: string
    category: string                   // e.g., "eCommerce platform", "compliance automation"
    differentiators: string[]
    proofPoints: string[]              // Metrics, customer logos, awards
    competitors: CompetitorProfile[]
  }

  // ─── ICP Segments ─────────────────────────────────────────────
  // Multiple segments — each with its own ICP, voice, messaging
  segments: ICPSegment[]

  // ─── Channels ─────────────────────────────────────────────────
  channels: {
    active: ChannelType[]
    preferences: Record<ChannelType, ChannelConfig>
  }

  // ─── Signals & Intent ─────────────────────────────────────────
  signals: {
    buyingIntentSignals: string[]      // "just raised Series B", "hiring SDRs"
    monitoringKeywords: string[]
    triggerEvents: string[]            // "leadership change", "tech stack migration"
  }

  // ─── Objection Library ────────────────────────────────────────
  objections: Objection[]

  // ─── Campaign Learnings ───────────────────────────────────────
  // Evolves over time — populated by RLHF feedback + manual input
  learnings: Learning[]

  // ─── System State ─────────────────────────────────────────────
  connectedProviders: string[]         // Populated from apiConnections table
  onboardingComplete: boolean
  lastUpdated: string                  // ISO date
  version: number                      // Schema version for migrations
}

export interface CompetitorProfile {
  name: string
  website: string
  positioning: string
  weaknesses: string[]
  battlecardNotes: string
}

export interface ICPSegment {
  id: string
  name: string                         // e.g., "Enterprise eCommerce", "Mid-Market SaaS"
  description: string
  priority: 'primary' | 'secondary' | 'exploratory'

  // Who to target
  targetRoles: string[]                // "VP Engineering", "Head of eCommerce"
  targetCompanySizes: string[]         // "200-1000", "1000+"
  targetIndustries: string[]
  keyDecisionMakers: string[]          // Specific titles in the buying committee

  // Why they buy
  painPoints: string[]
  buyingTriggers: string[]
  disqualifiers: string[]

  // How to speak to them
  voice: SegmentVoice
  messaging: SegmentMessaging

  // What content to create for them
  contentStrategy: SegmentContentStrategy
}

export interface SegmentVoice {
  tone: string                         // e.g., "technical but approachable"
  style: string                        // e.g., "practitioner sharing learnings"
  keyPhrases: string[]                 // Phrases that resonate with this segment
  avoidPhrases: string[]               // Words/phrases to never use
  writingRules: string[]               // e.g., "never lead with features", "use metrics"
  exampleSentences: string[]           // Reference sentences in the right voice
}

export interface SegmentMessaging {
  framework: string                    // e.g., "problem-agitate-solve", "before-after-bridge"
  elevatorPitch: string                // 30-second pitch for this segment
  keyMessages: string[]                // Top 3-5 messages
  objectionHandling: Array<{
    objection: string
    response: string
  }>
}

export interface SegmentContentStrategy {
  linkedinPostTypes: string[]          // "case study", "hot take", "how-to"
  emailCadence: string                 // "3-touch, 7 days apart"
  contentThemes: string[]              // Recurring themes for this segment
  redditSubreddits: string[]           // Where this segment hangs out
  keyTopics: string[]                  // What they search for / engage with
}

export type ChannelType = 'linkedin' | 'email' | 'reddit' | 'twitter' | 'cold-call' | 'events' | 'partnerships' | 'content-marketing' | 'paid-ads'

export interface ChannelConfig {
  frequency: string                    // "3x/week", "daily"
  style: string                        // "thought leadership", "direct outreach"
  notes: string
}

export interface Objection {
  id: string
  objection: string                    // "We already use [competitor]"
  context: string                      // When this typically comes up
  response: string                     // How to handle it
  segment: string                      // Which segment this applies to (or "all")
}

export interface Learning {
  id: string
  date: string                         // ISO date
  insight: string                      // "Subject lines with numbers get 2x open rate"
  source: 'campaign' | 'feedback' | 'manual' | 'rlhf'
  segment: string
  confidence: 'hypothesis' | 'validated' | 'proven'
}
```

#### 2. Create `src/lib/framework/context.ts`

This is the context builder. It takes a GTMFramework object and produces a string that gets injected into Claude's system prompt.

```typescript
export function buildFrameworkContext(framework: GTMFramework | null): string
```

Rules for the context builder:
- If framework is null or onboarding isn't complete, return a brief note telling Claude that no company context is loaded yet and it should ask the user about their business
- If framework exists, serialize the relevant sections into a readable prompt section
- Be smart about token usage — don't dump the entire JSON. Summarize learnings, pick the primary segment's voice for the current conversation context
- Include a section header: `## Your Company Context` so Claude knows this is personalized
- Include connected providers so Claude knows what tools are available

#### 3. Create `src/lib/framework/template.ts`

Export a `createEmptyFramework()` function that returns a GTMFramework with sensible empty defaults. This is what gets created when a new user signs up.

#### 4. Add DB table to `src/lib/db/schema.ts`

Add a `frameworks` table:

```typescript
export const frameworks = sqliteTable('frameworks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // For now single-user, but ready for multi-user
  userId: text('user_id').notNull().default('default'),
  // The full framework JSON
  data: text('data', { mode: 'json' }).notNull(),
  // Track onboarding progress
  onboardingStep: integer('onboarding_step').default(0),
  onboardingComplete: integer('onboarding_complete', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})
```

#### 5. Wire framework into `src/lib/ai/workflow-planner.ts`

Update the `buildSystemPrompt` function to:
- Fetch the framework from DB (or accept it as a parameter)
- Call `buildFrameworkContext(framework)`
- Inject the result into the system prompt after the current knowledge base section
- The framework context should come BEFORE the available providers section, because knowing the user's business informs which providers make sense

#### 6. Update `src/app/api/chat/route.ts`

Fetch the framework at the start of the request (same place where knowledge base and API connections are fetched). Pass it to the system prompt builder.

#### 7. Create folder structure for skills system

Create these empty placeholder files with TODO comments explaining their purpose:

```
src/lib/skills/
├── types.ts          # Skill interface: { name, description, trigger, execute }
├── registry.ts       # Skill discovery and registration
└── README.md         # Explains the skills architecture for future developers
```

The skills system will allow GTM-OS to expose capabilities (like "find companies matching ICP", "enrich list", "qualify leads") as composable, callable units. For now, just the types and folder structure.

#### 8. Create onboarding Jotai atoms in `src/atoms/onboarding.ts`

```typescript
import { atom } from 'jotai'

// Whether the onboarding modal is open
export const onboardingOpenAtom = atom<boolean>(false)

// Current step index (0-based)
export const onboardingStepAtom = atom<number>(0)

// Data collected during onboarding
export const onboardingDataAtom = atom<{
  websiteUrl: string
  linkedinUrl: string
  uploadedFiles: Array<{ name: string; content: string }>
  extractedFramework: Partial<GTMFramework> | null
  followUpAnswers: Record<string, string>
}>({
  websiteUrl: '',
  linkedinUrl: '',
  uploadedFiles: [],
  extractedFramework: null,
  followUpAnswers: {},
})

// Processing state for the AI extraction step
export const onboardingProcessingAtom = atom<boolean>(false)

// Follow-up questions generated by Claude
export const onboardingQuestionsAtom = atom<Array<{
  id: string
  question: string
  field: string       // Which framework field this fills
  inputType: 'text' | 'textarea' | 'select' | 'multi-select'
  options?: string[]  // For select/multi-select
}>>([])
```

---

## Part 2: Onboarding Popup

### What This Is

When a user opens GTM-OS for the first time (no framework in DB, or `onboardingComplete === false`), a full-screen modal overlay appears. It walks them through 5 steps to build their GTM context. After onboarding, every Claude interaction is personalized.

### The Flow

```
Step 1: Welcome
  "Let's set up your GTM operating system."
  → Company website URL (required)
  → LinkedIn company page or personal profile URL (optional)
  → [Continue]

Step 2: Upload Context
  "Drop any docs that describe your business."
  → Drag-and-drop zone accepting PDF, MD, TXT, DOCX
  → File list with remove buttons
  → Hint: "ICP documents, pitch decks, competitor analyses, positioning docs — anything that helps us understand your GTM."
  → [Continue] or [Skip — I'll add these later]

Step 3: Processing
  "Building your GTM context..."
  → Animated progress state (not a progress bar — use a sequence of status messages)
  → Status messages stream in:
    "Analyzing your website..."
    "Extracting company positioning..."
    "Identifying your ICP segments..."
    "Building messaging frameworks..."
    "Generating voice guidelines..."
  → This step calls POST /api/onboarding/extract (see API section below)
  → Auto-advances to Step 4 when processing completes

Step 4: Review & Edit
  "Here's what we found. Edit anything that's off."
  → Show the extracted framework in editable sections:
    - Company overview (name, industry, description) — text fields
    - Positioning (value prop, differentiators) — text fields + tag inputs
    - ICP Segments — expandable cards, each with roles, pain points, voice
    - Competitors — cards with name, positioning, weaknesses
  → Each section is collapsible
  → User can edit any field inline
  → [Looks good — Continue]

Step 5: Follow-Up Questions
  "A few more questions to fill the gaps."
  → Claude generates 3-5 questions based on what's MISSING from the framework
  → Questions appear one at a time (conversational feel, not a form)
  → Each answer updates the framework in real-time
  → When Claude has no more questions: [Complete Setup]
  → User can also [Skip remaining questions]
```

### Component Structure

```
src/components/onboarding/
├── OnboardingModal.tsx        # Full-screen overlay, step orchestrator
├── steps/
│   ├── WelcomeStep.tsx        # URL inputs
│   ├── UploadStep.tsx         # File drag-and-drop zone
│   ├── ProcessingStep.tsx     # Animated status messages
│   ├── ReviewStep.tsx         # Editable framework display
│   └── QuestionsStep.tsx      # Conversational follow-up questions
└── components/
    ├── StepIndicator.tsx      # Progress dots/steps at the top
    ├── FileDropZone.tsx       # Reusable drag-and-drop component
    └── FrameworkEditor.tsx    # Editable framework sections (used in ReviewStep)
```

### API Endpoints

#### `POST /api/onboarding/extract`

**Input:**
```typescript
{
  websiteUrl: string
  linkedinUrl?: string
  documents: Array<{ name: string; content: string }>  // Extracted text from uploaded files
}
```

**What it does:**
1. If websiteUrl is provided: use `fetch` to get the page HTML, extract text content (basic HTML-to-text — no need for Firecrawl, just strip tags). If that fails, that's OK — proceed with what you have.
2. Combine all context: website text + LinkedIn text + document contents
3. Call Claude (Sonnet) with a structured extraction prompt:
   - "Given the following company information, extract a structured GTM framework."
   - Use a tool/function call that matches the GTMFramework type
   - Claude fills in what it can, leaves unknowns as empty strings/arrays
4. Return the extracted framework as JSON

**Response:** Streaming SSE with status updates + final framework JSON
```
data: {"type": "status", "message": "Analyzing your website..."}
data: {"type": "status", "message": "Extracting company positioning..."}
data: {"type": "framework", "data": { ... GTMFramework ... }}
data: {"type": "done"}
```

#### `POST /api/onboarding/questions`

**Input:**
```typescript
{
  framework: Partial<GTMFramework>  // Current state of the framework
}
```

**What it does:**
1. Analyze which framework fields are empty or weak
2. Call Claude to generate 3-5 high-leverage questions that would fill the most important gaps
3. Return the questions

**Response:**
```typescript
{
  questions: Array<{
    id: string
    question: string
    field: string          // Which framework path this fills (e.g., "segments[0].painPoints")
    inputType: 'text' | 'textarea' | 'select' | 'multi-select'
    options?: string[]
  }>
}
```

#### `POST /api/onboarding/complete`

**Input:**
```typescript
{
  framework: GTMFramework
}
```

**What it does:**
1. Save the framework to the `frameworks` DB table
2. Set `onboardingComplete = true`
3. Return success

### Visual Design for Onboarding

The onboarding modal must feel premium and intentional — it's the user's first impression.

- **Full-screen overlay** — `fixed inset-0 z-50`, backdrop blur, semi-transparent bg
- **Centered card** — `max-w-2xl`, rounded-2xl, white bg, generous padding (p-8 or more)
- **Step indicator** — minimal dots or numbered steps at the top. Subtle, not distracting
- **Typography** — larger than the chat. Step titles should be `text-xl` or `text-2xl`. Body text `text-sm` minimum
- **Input fields** — spacious, rounded-lg, clear focus states with blueberry border
- **File drop zone** — dashed border, icon, clear feedback on drag-over (border color change, bg tint)
- **Processing animation** — status messages fade in one by one. Use matcha green for the checkmark/success states. Maybe a subtle pulse on the current status
- **Review step** — clean card layout for each framework section. Collapsible with smooth animation
- **Questions step** — conversational. One question visible at a time. Answer + next feels like a chat, not a form
- **Buttons** — primary CTA is the black button from the design system (`bg-[#1B1A18]`). Secondary is transparent with border. Generous sizing.
- **Transitions between steps** — smooth slide or fade. 300ms ease-out.

### Triggering the Onboarding

In `src/app/chat/page.tsx` (or `ChatPanel.tsx`):
- On mount, check if a framework exists in the DB (`GET /api/framework` or fetch inline)
- If no framework or `onboardingComplete === false`, set `onboardingOpenAtom` to `true`
- Render `<OnboardingModal />` when `onboardingOpenAtom` is true
- When onboarding completes, close the modal and the chat is immediately personalized

#### `GET /api/framework`

Simple endpoint that returns the current user's framework (or null if none exists). Used by the chat page to check if onboarding is needed, and by other components that need framework context.

---

## Part 3: CLAUDE.md Rewrite (after Parts 1 & 2 are built)

Rewrite the `CLAUDE.md` at project root. This is the single source of truth that any agent, MCP, or developer reads to understand the entire system. It must be comprehensive but scannable.

### Required Sections

1. **Product Identity** (5 lines)
   - What GTM-OS is, the core thesis, one-liner

2. **Tech Stack** (compact table)
   - Frontend, backend, DB, AI, state, styling — with versions

3. **Architecture Overview** (the 4 layers)
   - Dashboard, Chat, Table, Knowledge Base — one sentence each
   - How data flows: User → Chat → Claude → Workflow → Steps → Results → Table → Feedback

4. **The Framework System** (NEW — this is the key addition)
   - What the GTMFramework is and why it exists
   - How it gets populated (onboarding flow, future)
   - How it gets injected into prompts (context builder)
   - How it evolves (RLHF feedback, manual edits, campaign learnings)
   - File locations: `src/lib/framework/types.ts`, `context.ts`, `template.ts`

5. **Database Schema** (compact reference)
   - Table name → one-line purpose → key columns
   - Include the new `frameworks` table
   - Mention FTS5 virtual table for knowledge search

6. **API Patterns**
   - SSE streaming pattern (reference `/api/chat/route.ts`)
   - How to call Claude (Anthropic SDK singleton in `src/lib/ai/client.ts`)
   - Model selection: Sonnet for planning, Opus for qualification
   - How system prompts are built (framework → knowledge → providers → instructions)

7. **Provider System**
   - How workflow steps map to providers
   - How API keys are stored (AES-256-GCM in `apiConnections` table)
   - How to add a new provider

8. **RLHF & Feedback Pipeline**
   - Every result row has feedback (approve/reject/flag)
   - Feedback feeds into framework.learnings
   - Workflow-level rating after completion

9. **Skills System** (placeholder for future)
   - What skills are and how they'll work
   - Folder: `src/lib/skills/`

10. **UI Conventions**
    - Tailwind tokens reference (colors, typography)
    - Component patterns (where things live)
    - Design system rules from `docs/BRAND.md`

11. **File Map** (every important file with one-line description)

12. **Conventions**
    - Commit format: `feat: [feature] (Day XX)`
    - Task handoff: `tasks/day-XX.md` → `tasks/day-XX-report.md`
    - `pnpm build` must pass before committing

Keep the entire file under 300 lines. Be dense, not verbose.

---

## Part 4: Chat Visual Overhaul

### Context

The current chat doesn't feel premium. Text is tiny (everything is `text-xs`), spacing is cramped, there's no visual hierarchy, and the overall feel is "prototype" not "product."

### Process

**Step 0: Take a "before" screenshot**
- Run the app (`pnpm dev`)
- Use the web browsing skill to navigate to `http://localhost:3000`
- Take a screenshot and save it to `docs/screenshots/day-02-before.png`

**Step 1: Study Clay's design language**
- Use the web browsing / frontend-design skill to visit and inspect `https://clay.com`
- Extract and note:
  - Typography scale (how they size headlines vs body vs labels)
  - Spacing rhythm (padding, margins, gaps between elements)
  - How they use whitespace to create breathing room
  - Card elevation and shadow patterns
  - Transition timings and easing curves
  - How accent colors are used sparingly
  - The overall "weight" of the page — how it feels substantial without being heavy

**Step 2: Redesign the chat experience**

Focus on these components ONLY (don't touch Sidebar or other pages):

#### ChatInput.tsx
- **Increase text size** — at least `text-sm` (14px) for the textarea, not `text-xs`
- **More generous padding** — the input area should feel spacious, like a premium text editor
- **Refined border treatment** — consider a thicker border or subtle gradient border on focus
- **Send button** — make it feel more intentional. Consider sizing it up slightly
- **Remove or refine the char counter** — it's noisy. Move it to only appear when approaching a limit, or remove entirely

#### MessageBubble.tsx
- **Increase message text size** — `text-sm` (14px) minimum for readability
- **Wider max-width** — `max-w-xl` is too narrow in a full-screen layout. Go to `max-w-2xl` or wider
- **User messages** — the black pill is fine but make it feel more considered. Generous padding. Maybe rounded-2xl
- **Assistant messages** — more breathing room. Consider removing the border and using just subtle background differentiation. The current border + shadow combo is noisy
- **Line height** — increase to `leading-relaxed` (1.625) for body text. Monospace needs more line height to be readable

#### MessageList.tsx (Empty State)
- **The "Yalc" wordmark** — 52px is good but consider going bigger and bolder. This is the first thing users see
- **Action cards** — they feel small and cramped. Increase padding, increase icon size, add more whitespace between them
- **The tagline** — make it more prominent. It's the hook. Consider larger text
- **Overall vertical centering** — the empty state should feel centered and intentional, not pushed to the top

#### WorkflowPreviewCard.tsx
- **Increase internal padding** — the card content is pressed against the edges
- **Step descriptions** — increase line height, consider `text-sm`
- **Step number circles** — they work well, keep them but consider sizing up slightly
- **Action bar** — the "Run this workflow" button should feel like a confident CTA. Make it bigger, more padding
- **Overall card width** — `max-w-[600px]` might need to go up. Test at different viewport widths

#### globals.css
- **Scrollbar styling** — keep it subtle but make sure it doesn't flash or distract
- **Selection color** — add a custom `::selection` style using blueberry tint
- **Smooth scrolling** — ensure `scroll-behavior: smooth` is set

#### General Principles
- **Typography hierarchy matters** — not everything should be the same size. Headlines > body > captions. Create clear visual levels
- **Whitespace is premium** — when in doubt, add more padding, more margin, more gap
- **Transitions should feel intentional** — 150-200ms for micro-interactions, 300ms for layout changes
- **One accent per section** — respect the brand guide
- **Space Mono needs room** — monospace fonts need more letter-spacing and line-height than proportional fonts to feel comfortable

**Step 3: Take an "after" screenshot**
- Save to `docs/screenshots/day-02-after.png`

---

## Commit Convention

Three commits today (in order):

1. `feat: GTM framework architecture + context system (Day 2)`
   - Framework types, DB table, context builder, template, skills folder structure
   - Wired into workflow-planner.ts and /api/chat

2. `feat: onboarding popup — AI-powered company context builder (Day 2)`
   - OnboardingModal with 5 steps
   - /api/onboarding/extract, /api/onboarding/questions, /api/onboarding/complete, /api/framework
   - Onboarding atoms
   - Triggered on first visit when no framework exists

3. `feat: premium chat visual overhaul + CLAUDE.md rewrite (Day 2)`
   - All visual changes to chat components
   - Comprehensive CLAUDE.md rewrite
   - Before/after screenshots

---

## Process

1. Read all files listed above
2. **Part 1 first** — create framework types, DB table, context builder, wire into system prompt
3. **Part 2 second** — build the onboarding popup (components, API endpoints, state)
4. **Part 3 third** — rewrite CLAUDE.md with full architecture knowledge (including onboarding system)
5. **Part 4 fourth** — visual overhaul with Clay inspection
6. `pnpm build` — fix all TypeScript errors
7. Commit (three separate commits, in order)
8. Write report to `tasks/day-02-report.md`:
   - What you built (bullet points per part)
   - Framework schema decisions you made
   - Onboarding UX decisions you made
   - Visual changes with rationale
   - Anything the team should review
