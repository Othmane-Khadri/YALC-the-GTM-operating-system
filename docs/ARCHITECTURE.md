# GTM-OS — Project Architecture

```
gtm-os/

├── .claude/
│   └── CLAUDE.md                    # Master instructions, framework, rules

├── docs/
│   ├── ARCHITECTURE.md              # This file — full project map
│   ├── BRAND.md                     # Design system (colors, typography, spacing)
│   ├── DIRECTION.md                 # Product vision + 30-day build plan
│   └── screenshots/                 # Before/after UI captures

├── tasks/
│   ├── day-02.md                    # Day 2 brief (framework + onboarding + visual)
│   ├── day-02-design.md             # Visual spec — every component, pixel-exact
│   ├── day-02-design-corrections.md # CTO audit — systemic fixes, per-component diffs
│   └── day-02-report.md             # What was built, decisions made, commit plan

├── src/
│   ├── app/                         # Next.js App Router — pages + API routes
│   │   ├── layout.tsx               # Root layout (Space Mono font, Jotai provider)
│   │   ├── page.tsx                 # Landing redirect → /chat
│   │   ├── globals.css              # Design tokens, animations, input-focus utility
│   │   │
│   │   ├── chat/
│   │   │   └── page.tsx             # Main page — sidebar + chat + onboarding trigger
│   │   │
│   │   └── api/
│   │       ├── chat/
│   │       │   └── route.ts         # SSE streaming — Claude tool calling + workflows
│   │       ├── framework/
│   │       │   └── route.ts         # GET — returns framework or null
│   │       └── onboarding/
│   │           ├── extract/
│   │           │   └── route.ts     # POST SSE — fetches website, Claude extracts GTM context
│   │           ├── questions/
│   │           │   └── route.ts     # POST — generates follow-up questions from gaps
│   │           └── complete/
│   │               └── route.ts     # POST — saves framework, marks onboarding done
│   │
│   ├── atoms/                       # Jotai state — global, no prop drilling
│   │   ├── conversation.ts          # Messages, streaming text, input, sidebar state
│   │   └── onboarding.ts            # Modal open, step index, collected data, questions
│   │
│   ├── components/
│   │   ├── chat/                    # THE CONVERSATION — core interaction loop
│   │   │   ├── ChatPanel.tsx        # Orchestrator — wires messages + input + streaming
│   │   │   ├── ChatInput.tsx        # Textarea + send button, focus-within ring
│   │   │   ├── MessageList.tsx      # Empty state (wordmark + action cards) + message feed
│   │   │   ├── MessageBubble.tsx    # Asymmetric: user = dark bubble, assistant = open text
│   │   │   └── WorkflowPreviewCard.tsx  # Step-by-step workflow preview + approve CTA
│   │   │
│   │   ├── layout/
│   │   │   └── Sidebar.tsx          # Nav with SVG icons, SOON badges, collapse toggle
│   │   │
│   │   └── onboarding/             # 5-STEP ONBOARDING — AI-powered context builder
│   │       ├── OnboardingModal.tsx   # Full-screen overlay, step orchestrator
│   │       ├── components/
│   │       │   ├── StepIndicator.tsx     # 5-dot progress (blueberry active dot)
│   │       │   ├── FileDropZone.tsx      # Drag-and-drop (PDF, MD, TXT, DOCX)
│   │       │   └── FrameworkEditor.tsx   # Collapsible sections, tag inputs, inline edit
│   │       └── steps/
│   │           ├── WelcomeStep.tsx       # Step 0: website URL + LinkedIn
│   │           ├── UploadStep.tsx        # Step 1: document upload
│   │           ├── ProcessingStep.tsx    # Step 2: SSE extraction with staggered statuses
│   │           ├── ReviewStep.tsx        # Step 3: editable framework display
│   │           └── QuestionsStep.tsx     # Step 4: conversational follow-ups + progress bar
│   │
│   └── lib/                         # BUSINESS LOGIC — no UI, pure functions
│       ├── utils.ts                 # cn() helper (clsx wrapper)
│       ├── crypto.ts                # AES-256-GCM encrypt/decrypt for API keys
│       │
│       ├── ai/                      # CLAUDE INTEGRATION — the brain
│       │   ├── client.ts            # Anthropic SDK singleton
│       │   ├── types.ts             # ChatMessage, WorkflowDefinition, step types
│       │   └── workflow-planner.ts  # System prompt builder + tool definitions
│       │
│       ├── db/                      # DRIZZLE + SQLITE — local-first persistence
│       │   ├── index.ts             # DB connection (better-sqlite3)
│       │   ├── schema.ts            # 9 tables: conversations, messages, workflows,
│       │   │                        #   workflow_steps, result_sets, result_rows,
│       │   │                        #   knowledge_items, api_connections, frameworks
│       │   └── migrations/          # Drizzle migration files
│       │
│       ├── framework/               # GTM FRAMEWORK — the intelligence layer
│       │   ├── types.ts             # GTMFramework, ICPSegment, CompetitorProfile, Learning
│       │   ├── template.ts          # createEmptyFramework() — sensible defaults
│       │   └── context.ts           # buildFrameworkContext() — serializes for Claude prompt
│       │
│       └── skills/                  # SKILLS SYSTEM — Day 3+ (placeholder)
│           ├── types.ts             # Skill interface definition
│           ├── registry.ts          # Skill discovery + registration
│           └── README.md            # Architecture notes for future implementation

├── CLAUDE.md                        # Project rules for Claude Code sessions
├── next.config.mjs                  # Next.js config
├── tailwind.config.ts               # Design tokens mapped to CSS variables
├── drizzle.config.ts                # Drizzle ORM → SQLite config
├── tsconfig.json                    # TypeScript strict mode
├── postcss.config.js                # Tailwind PostCSS plugin
├── package.json                     # pnpm, Next 14, Drizzle, Jotai, Anthropic SDK
├── .env.example                     # Required env vars template
├── .env.local                       # Actual secrets (gitignored)
├── gtm-os.db                        # SQLite database (gitignored)
└── .gitignore                       # node_modules, .next, .env.local, *.db
```

## Stack

| Layer        | Choice                  | Why                                           |
|-------------|-------------------------|-----------------------------------------------|
| Framework   | Next.js 14 (App Router) | SSR + API routes in one repo                  |
| Styling     | Tailwind CSS            | Design tokens as classes, no CSS-in-JS runtime|
| State       | Jotai                   | Atomic, no boilerplate, SSE-friendly          |
| Database    | SQLite + Drizzle ORM    | Local-first, zero infra, type-safe queries    |
| AI          | Anthropic SDK (Claude)  | Tool calling for structured workflow proposals |
| Font        | Space Mono              | Monospace = technical credibility              |

## Data Flow

```
User types goal
    → ChatInput (Jotai atom)
    → POST /api/chat (SSE stream)
    → Claude with framework context + tool definitions
    → Tool call: propose_workflow
    → WorkflowPreviewCard rendered
    → User approves → workflow executes step-by-step
```

## Design System

- **Canvas:** Warm oat white (`#F9F8F6`), never pure white
- **Type:** Black (`#1B1A18`) on oat, 14px base
- **Accents:** Blueberry (primary), Matcha (success), Pomegranate (error)
- **Rule:** 70% warm neutrals, 20% structured grey, 10% concentrated color
- **Spacing:** Generous — `rounded-2xl`, `p-6`, `gap-4` as defaults
