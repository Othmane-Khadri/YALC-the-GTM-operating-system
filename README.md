# GTM-OS

**An open-source, AI-native operating system for running any GTM campaign.**

Describe your goal in plain language. GTM-OS proposes the best workflow — the data sources, enrichment steps, qualification criteria — all informed by your own knowledge base. Approve, execute, verify results in an interactive table.

> Built in public. 30 days. No shortcuts.
> Day 1 of 30 · March 3, 2026

---

## The Core Idea

Clay is a spreadsheet with enrichment columns. GTM-OS is an intelligence layer that happens to output tables.

- **Chat-first interface** — the spreadsheet is a verification layer, not the creation layer
- **AI proposes, you approve** — like Cursor, but for GTM workflows
- **Your knowledge base is the differentiator** — upload your ICP, templates, competitor docs. The AI uses them in every workflow.
- **RLHF built in** — approve/reject rows, tag bad data. The system gets better at your specific GTM operation.
- **MCP-interoperable** — bring your own Apollo, Firecrawl, BuiltWith, Clay keys

---

## Getting Started

```bash
git clone https://github.com/earleads/gtm-os
cd gtm-os
pnpm install
cp .env.example .env.local
# Add your ANTHROPIC_API_KEY to .env.local
pnpm db:push
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## What Ships in 30 Days

- [x] **Day 1:** Chat interface + AI workflow planner + SQLite foundation
- [ ] **Day 2:** Workflow execution engine (Apollo search)
- [ ] **Day 3:** Results table with RLHF feedback
- [ ] **Day 4:** Knowledge base (drag-and-drop ICP/template upload)
- [ ] **Day 5:** API key vault (encrypted local storage)
- [ ] ...

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | Next.js 14, React 18, TypeScript |
| Styling | Tailwind CSS, Space Mono font |
| State | Jotai |
| Backend | Next.js API Routes (streaming SSE) |
| Database | SQLite + Drizzle ORM (local) / Postgres (hosted) |
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
