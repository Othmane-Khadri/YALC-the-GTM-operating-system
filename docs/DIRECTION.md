# GTM OPERATING SYSTEM
## Day 1 — Product Direction & Architecture Brief

**Author:** Othmane (Founder & CEO, Earleads)
**Date:** March 3, 2026 — Day 1 of 30
**Repo:** github.com/earleads/gtm-os (MIT License)
**Purpose:** Hand-off document for the architecture agent to propose the optimal technical foundation for Day 1 implementation.

---

## 1. What We're Building

### 1.1 The One-Line Vision
An open-source, AI-native operating system for running any GTM campaign — where the primary interface is a conversation, not a spreadsheet.

### 1.2 What This Is NOT
- Not a Clay clone with a different UI. Clay is a spreadsheet with enrichment columns. We are an intelligence layer that happens to output tables.
- Not a CRM. We don't store relationship history. We orchestrate campaigns.
- Not a no-code automation tool. We're not Zapier or Make. We're a reasoning engine that builds and executes GTM workflows.
- Not a chatbot wrapper. The chat is the command center, but the product has structured views, dashboards, and collaborative editing surfaces.

### 1.3 What This IS
The framework to operate any GTM campaign. The user describes an outcome in natural language. The system proposes the best architecture to achieve it — the workflow steps, the data sources, the enrichment logic, the qualification criteria — all informed by the user's own knowledge base. The user approves, modifies, or collaborates. The system executes. Results render as interactive tables for human verification, feedback, and fine-tuning.

> **CORE THESIS:** Intelligence is available at every step. Structure is the foundation. The user's knowledge is the differentiator. The table is the verification layer, not the creation layer.

### 1.4 The Experience We're Replicating
The UX draws from five tools that GTM engineers already love:
- **Chat interfaces (ChatGPT, Claude):** Natural language as the primary input.
- **LLM query patterns (Claude API):** Deep reasoning, qualification, personalization — intelligence available everywhere.
- **Cursor / Claude Code:** The collaborative agent model. System proposes, user approves or modifies.
- **Notion:** Clean white pages. Friendly editing. Full visibility and control.
- **Obsidian:** Knowledge-first architecture. Everything links. Context compounds over time.
- **Clay tables:** Spreadsheet as verification and fine-tuning layer. Inspect, tag, validate, trigger feedback loops.

---

## 2. Core UX Principles & Design Decisions

### 2.1 Chat-First, Table-Fallback
The chat is THE main interface. Not a sidebar, not a modal. When the user opens the app, the chat is the dominant surface. Everything else — tables, dashboards, knowledge — are views that the chat creates, manages, and navigates to.

The table appears when results exist. Unlike Clay, the table is a VIEW, not the source of truth. The table is for:
- Human verification of AI-generated results
- Tagging and feedback (RLHF-style: did you like this result? Yes/No per row)
- Fine-tuning and manual corrections
- Triggering downstream actions

> **DESIGN PRINCIPLE:** The spreadsheet is mechanically easier for verification. The chat is the creation layer. Never confuse them.

### 2.2 AI-Native — Intelligence Everywhere
- **Workflow construction:** Agents build and propose architectures based on outcomes.
- **Qualification:** Every enrichment step can invoke LLM reasoning against the knowledge base.
- **Feedback loops:** System autonomously reviews before launch.
- **Knowledge integration:** Uploaded ICPs, templates, competitor analysis used contextually without manual reference.

> **What "Very Opinionated" Means:** The AI doesn't present a blank canvas. It suggests the best workflow, data sources, qualification criteria. The user approves, modifies, or redirects — not builds from scratch. Think Cursor: agent proposes a diff, you accept or edit.

### 2.3 Structure-First — Clean Onboarding Builds Context
Onboarding Flow:
1. User drops a link or describes their company
2. System asks 3-4 high-leverage questions (ICP, channels, tools, pain)
3. Onboarding agent runs in background — scraping, analyzing, building context
4. System asks 2-3 follow-up questions based on what the agent discovered
5. Completely personalized interface generated based on declared GTM goals

> **ONBOARDING GOAL:** Under 5 minutes. By the end: system knows your ICP, positioning, API keys, GTM channels, and first desired outcome.

### 2.4 The User Always Has the Hand
- Every workflow step is editable
- Every knowledge document is browsable
- Every table row can receive feedback
- Rules and context can be embedded at any point

---

## 3. Information Architecture & Screen Map

### 3.1 The Four Layers

**Layer 1: The Dashboard (Default Landing)**
Active workflows + status, outcome progress, recent results, knowledge base health, quick-launch shortcuts.

**Layer 2: The Chat (Primary Action Interface)**
Accessible from anywhere. Context-aware — knows which table you're looking at, which workflow is running.

**Layer 3: The Table (Verification & Fine-Tuning Layer)**
Sorting, filtering, per-row RLHF feedback, manual edits, export (CSV/JSON/CRM push), fine-tuning triggers.

**Layer 4: The Knowledge Base (Context & Intelligence Foundation)**
ICPs, messaging frameworks, competitor intelligence, campaign learnings. Referenced automatically. Updatable by agents.

### 3.2 Navigation Model (Sidebar)
1. Dashboard — ops overview, default landing
2. Chat / Workflows — conversation history, each maps to a workflow
3. Knowledge Base — drag-and-drop, type tags (ICP, Template, Competitive, Learning)
4. API Connections — secure vault
5. Settings — team, preferences, export configs

---

## 4. Feedback & RLHF System

### 4.1 Table-Level Feedback
Every row: approve / reject / flag. Tags per row. Signals feed back into qualification model.

### 4.2 Workflow-Level Feedback
Post-completion rating. Step-level flagging. Provider performance tracking.

### 4.3 Pre-Launch Review (AI-native)
Before any campaign launches: data quality check, personalization validation, knowledge base cross-reference, duplicate detection, human approval gate.

> **RLHF PRINCIPLE:** Every interaction with the table is a training signal. The system gets better at YOUR specific GTM operation over time.

---

## 5. Interoperability & MCP Architecture

### 5.1 MCP-First Design
- Every workflow step can be an MCP tool call
- System consumes external MCP servers (Clay, Apollo, Salesforce, HubSpot, Slack, Gmail, Notion)
- System exposes its own capabilities as MCP server (future)
- Results and context portable to any MCP-compatible UI

### 5.2 API Key Vault
User brings own keys. Encrypted at rest. Prompted contextually. Supports key rotation.

### 5.3 Data Portability
Tables → CSV / JSON / CRM push. Workflows → JSON definitions (importable). Knowledge → original format. Feedback data → exportable for custom model training.

---

## 6. MVP Scope — 30-Day Build

### 6.1 What Ships in 30 Days

**Component 1: The Chat Interface**
Full-screen chat as primary UI. Natural language → structured workflow generation. Workflow preview cards with step-by-step breakdown. One-click approval or inline editing. Context-aware (knowledge base, connected APIs).

**Component 2: The Table / Verification Layer**
Results render inline in conversation. Expandable to full-screen. Sortable, filterable, exportable (CSV). Per-row feedback. Manual column addition and editing.

**Component 3: API Key Vault**
Secure env var storage. Contextual prompting. Initial integrations: Apollo, Clay, Anthropic/OpenAI, Firecrawl, BuiltWith. Connection status in sidebar.

**Component 4: Knowledge Base**
Drag-and-drop upload (PDF, Markdown, text). Type tagging. Referenced by chat and workflows automatically. /knowledge command. Browsable and editable.

### 6.2 What Does NOT Ship in 30 Days
- Full dashboard with live metrics (placeholder only)
- Onboarding agent flow (manual setup for MVP)
- Multi-user / team features
- Automated pre-launch review system
- Knowledge base auto-updating from campaign results
- MCP server exposure (consume only, don't expose yet)

### 6.3 Tech Stack
- **Frontend:** React + Next.js (App Router, TypeScript)
- **Styling:** Tailwind CSS (dark mode default)
- **State:** Zustand or Jotai (lightweight, no boilerplate)
- **Backend:** Next.js API routes + tRPC or server actions
- **Database:** SQLite (local-first) or Postgres (hosted)
- **AI Layer:** Anthropic SDK (Claude) primary, OpenAI-compatible for flexibility
- **MCP:** MCP TypeScript SDK for consuming external servers
- **Auth:** None for v1 (local-first), optional for hosted
- **License:** MIT

---

## 7. Architecture Decisions for the Agent

### 7.1 Chat → Workflow Translation
How does natural language become a structured workflow?
- Single LLM call with function calling
- Multi-step agent with planning phase
- Template matching + LLM customization

### 7.2 Knowledge Base Storage & Retrieval
- Simple text extraction + full-text search
- Embedding-based RAG with vector store
- Hybrid: full-text for exact, embeddings for semantic

### 7.3 Workflow Execution Model
- Sequential execution in API route
- Job queue with background workers
- Streaming execution with real-time updates

### 7.4 Data Model
Core entities: Workflow, Step, Table/Result Set, Knowledge Item, API Connection, Feedback

### 7.5 Local-First vs. Server-First
Need abstraction layer that works locally AND in cloud without major refactoring.

---

## 8. Day 30 Success Criteria

By Day 30, a user should be able to:
- Open the app and see a clean chat-first interface
- Type a natural language GTM query
- See the AI propose a workflow with specific steps and data sources
- Approve the workflow with one click
- Watch results populate in a table inline in the chat
- Sort, filter, and give feedback on individual rows
- Upload knowledge documents referenced by AI in future queries
- Connect their own API keys securely
- Export results as CSV
- Clone the repo and run locally with a single command

> **THE LITMUS TEST:** If a solo founder can clone the repo, add their Apollo and Anthropic API keys, upload their ICP, and get a qualified lead list in under 10 minutes — we've shipped something worth starring.

---

## 9. What Today's Decisions Influence

- **Chat-First → Frontend Architecture:** Conversation is the primary entity, not tables. Routing, state, component hierarchy all flow from this.
- **Very Opinionated AI → Prompt Engineering & Agent Design:** Planning agent is core IP. Prompt architecture is Day 1 work.
- **RLHF Everywhere → Data Model & Feedback Pipeline:** Every table row needs a feedback schema from Day 1.
- **MCP Interoperability → Plugin Architecture:** Workflow steps are abstracted as tool calls, not hardcoded functions.
- **Knowledge Base → Context Window Management:** Retrieval strategy needed for multi-document context.
- **Dashboard as Default Landing → State Aggregation:** Data model must support dashboard view from Day 1.
- **Clean Onboarding → Onboarding Agent Pipeline:** Context model must be dynamic and user-specific from the start.
- **Open Source + Local-First → Zero External Dependencies:** MIT licensed, runs on user's machine with a single command. Most important constraint for adoption.

---

*End of Day 1 Direction Document*
*Next step: Architecture agent proposes the technical foundation and Day 1 implementation plan.*
