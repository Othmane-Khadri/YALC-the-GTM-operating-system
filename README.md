# YALC — Yet Another Lead Compiler

**An open-source, AI-native operating system for running any GTM campaign.**

Describe your goal in plain language. YALC proposes the best workflow — the data sources, enrichment steps, qualification criteria — all informed by your own knowledge base. Approve, execute, verify results in an interactive table.

> Built in public. 30 days. No shortcuts.
> Started March 3, 2026

---

## The Core Idea

Clay is a spreadsheet with enrichment columns. YALC is an intelligence layer that happens to output tables.

- **Chat-first interface** — the spreadsheet is a verification layer, not the creation layer
- **AI proposes, you approve** — like Cursor, but for GTM workflows
- **Your knowledge base is the differentiator** — upload your ICP, templates, competitor docs. The AI uses them in every workflow.
- **RLHF built in** — approve/reject rows, tag bad data. The system gets better at your specific GTM operation.
- **MCP-interoperable** — bring your own Apollo, Firecrawl, BuiltWith, Clay keys

---

## Getting Started

```bash
git clone https://github.com/Othmane-Khadri/YALC-the-GTM-operating-system.git
cd YALC-the-GTM-operating-system
pnpm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
pnpm db:push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Build Log

### Day 1 — Foundation
- Chat interface with streaming SSE responses from Claude
- AI workflow planner: describe a GTM goal, get a structured multi-step workflow proposal
- SQLite database with Drizzle ORM, full schema for conversations, messages, workflows, and result sets

### Day 2 — GTM Framework + AI Onboarding
- GTM Framework schema (company identity, positioning, ICPs, channels, learnings) with Claude-powered onboarding that extracts strategy from your website + uploaded docs
- 5-step onboarding modal (website input, document upload, AI processing, review, follow-up questions) with SSE streaming status
- Visual overhaul: Space Mono, transparent assistant messages, staggered animations, SVG icons

### Day 3 — Execution Engine + Tables + RLHF
- Execution engine generates lead batches via Claude with quality distribution (30% great / 40% okay / 30% poor ICP fit) — streamed into chat
- Full table UI with Vim-style keyboard shortcuts (j/k/a/r/f), RLHF feedback column (approve/reject/flag), sortable columns with typed renderers
- Learning extractor: approved/rejected leads feed into Claude pattern recognition, surfaces insights for user review before saving to framework

### Day 4 — Systems Architecture (12 Interconnected Systems)
- Provider registry + abstraction layer, MCP client/server, skills engine (find-companies, enrich-leads, qualify-leads, export-data)
- Intelligence system (8 categories, evidence-backed, confidence scoring), human review queue, web intelligence layer (3-tier fetch: cache, Firecrawl MCP, built-in)
- Campaign-as-hypothesis framework, continuous learning loop, provider intelligence (per-segment scoring), nudge engine, data quality monitor (dedup + completeness + anomaly detection)

### Day 5 — Design Rebrand + Knowledge Base
- Migrated from fruit-named palette to The Kiln design language — semantic color tokens, DM Sans + Inter fonts, WCAG AA contrast
- `/tables` list page (card grid with feedback progress bars) and `/knowledge` page (drag-drop upload, type filtering, 100k char cap, PDF support)
- Accessibility: SVG icons replacing emoji, 44px touch targets, prefers-reduced-motion support

### Day 6 — Security Audit + Knowledge AI Pipeline
- Pre-public security audit: zero hardcoded secrets, AES-256-GCM encryption, SSRF protection, MCP env isolation, timing-safe auth. Fixed 3 vulnerabilities before release.
- Knowledge → AI pipeline: FTS5 full-text search with sync triggers, knowledge injected into Claude's system prompt, full-text injection for small docs (< 4000 chars)
- Dual-repo strategy: public MIT repo (all source code) + private fork (production rate limiting, Vercel deployment)

### Day 7+ — Coming next
- Real provider integrations (Apollo, Firecrawl, BuiltWith)
- Campaign execution with multi-channel orchestration
- Export to CSV/CRM
- Collaborative workspaces
- ...

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 14, React 18, TypeScript |
| Styling | Tailwind CSS, DM Sans + Inter |
| State | Jotai |
| Backend | Next.js API Routes (streaming SSE) |
| Database | SQLite + Drizzle ORM (local) / Turso (hosted) |
| AI | Anthropic Claude (Sonnet for planning, Opus for qualification) |
| License | MIT |

---

## Philosophy

> Intelligence is available at every step. Structure is the foundation. The user's knowledge is the differentiator. The table is the verification layer, not the creation layer.

---

## Follow the Build

- Daily build logs: [Substack](https://othmanekhadri.substack.com)
- LinkedIn updates: [Othmane Khadri](https://linkedin.com/in/othmanekhadri)

---

## License

MIT — do whatever you want with it.
