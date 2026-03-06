# GTM-OS — Systems Architecture

**Version:** 2.0
**Date:** March 6, 2026
**Author:** CTO (Claude)
**Purpose:** Define how the 8 core systems integrate to transform GTM-OS from a lead list tool into an autonomous, intelligence-driven GTM operating system.

---

## Foundational Reframe

Three principles that govern every design decision in this document:

### 1. Intelligence is the product, not a side effect

The OS's primary asset is not lead lists or content — it's the **intelligence** it accumulates about what works for this specific user, this specific ICP, this specific market. Intelligence must be precisely defined, cleanly segmented, and free from bias. Every system contributes to it, every system consumes it.

### 2. A campaign is a hypothesis

A campaign is not "send 50 emails." It's a testable thesis: *"We believe pain-point messaging about compliance costs converts mid-market CFOs in Germany via LinkedIn."* The OS runs the experiment, measures the result, and updates its intelligence. Content campaigns are hypotheses. Outreach campaigns are hypotheses. Even the choice of API provider is a hypothesis that gets validated or disproven with data.

### 3. Skills are the execution primitives

Every recurring task the OS performs is a **Skill** — a standardized, composable, selectable unit of work. Finding companies is a skill. Writing a post is a skill. Writing an A/B test outreach sequence is a skill. The OS selects and composes skills based on the hypothesis being tested and the intelligence it has accumulated. Skills are not a nice-to-have — they're the foundation that makes everything else possible.

---

## Current Architecture (Days 1-4)

```
                    ┌─────────────────────┐
                    │   FRAMEWORK (DB)    │
                    │  company, ICP,      │
                    │  learnings[]        │
                    └────────┬────────────┘
                             │ injected into every Claude call
                             ▼
USER ──chat──▶ PLANNER (Claude) ──proposes──▶ WORKFLOW
                                                │
                                         user approves
                                                │
                                                ▼
                                    EXECUTION ENGINE (mock)
                                         │ SSE batches
                                         ▼
                                    RESULT TABLE
                                         │
                                    user reviews
                                         │
                                         ▼
                                    RLHF EXTRACTION (Claude Opus)
                                         │
                                    user confirms
                                         │
                                         ▼
                                    FRAMEWORK.LEARNINGS updated
                                    (loop closes on next chat)
```

**Existing DB tables:** conversations, messages, workflows, workflowSteps, resultSets, resultRows, knowledgeItems, apiConnections, frameworks, mcpServers (Day 4)

**Existing type system:** GTMFramework, Learning, WorkflowDefinition, ProposedStep, ChatMessage, ColumnDef, StepExecutor (Day 4)

---

## Intelligence: The Core Concept

Before defining the 8 systems, we must define what **intelligence** means in this OS. Every system either produces intelligence, consumes it, or both.

### What Is Intelligence?

Intelligence is a **structured, segmented, evidence-backed insight** about what works and what doesn't for a specific context. It is NOT vague patterns like "emails work well." It IS precise conclusions like:

> "For mid-market SaaS companies (100-300 employees) in the DACH region, pain-point messaging about compliance costs delivered via LinkedIn InMail on Tuesday mornings achieves a 34% response rate — 2.8x the baseline. Evidence: 3 campaigns, 847 sends, 287 responses. Confidence: proven."

### Intelligence Categories

| Category | What it captures | Example |
|----------|-----------------|---------|
| **ICP Intelligence** | Who converts and who doesn't | "Companies with React in their tech stack convert 4.2x more than average" |
| **Channel Intelligence** | Which channels work for which segments | "LinkedIn outperforms email for CTOs by 2.3x, but email wins for ops roles" |
| **Content Intelligence** | What messaging resonates | "Pain-point openers get 3x more replies than benefit-led openers for this segment" |
| **Timing Intelligence** | When to reach out | "Tuesday 9-11am CET yields 40% higher open rates for DACH prospects" |
| **Provider Intelligence** | Which tools perform best | "Apollo returns 23% more valid emails than Hunter for European companies" |
| **Qualification Intelligence** | How to score leads | "Employee count 100-300 + Series B + hiring for sales = 85% ICP match" |
| **Campaign Intelligence** | What campaign structures work | "3-touch email + LinkedIn comment-first performs 2x vs email-only" |
| **Competitive Intelligence** | How the market is shifting | "Competitor X launched a free tier — price sensitivity mentions up 60% this month" |

### Intelligence Data Model

Replace the flat `Learning` type with a structured intelligence system:

```typescript
interface Intelligence {
  id: string
  category: IntelligenceCategory          // from the 8 categories above
  insight: string                         // The specific, actionable conclusion
  evidence: Evidence[]                    // What supports this
  segment: string | null                  // Which ICP segment this applies to (null = global)
  channel: string | null                  // Which channel (null = all)
  confidence: 'hypothesis' | 'validated' | 'proven'
  confidenceScore: number                 // 0-100, computed from evidence quality + quantity
  source: IntelligenceSource              // How it was generated
  bias_check: BiasCheck | null            // Was this validated for bias?
  supersedes: string | null               // ID of the intelligence this replaces (evolution)
  createdAt: string
  validatedAt: string | null
  expiresAt: string | null                // Some intelligence decays (e.g., timing patterns)
}

interface Evidence {
  type: 'campaign_result' | 'rlhf_feedback' | 'ab_test' | 'user_correction' |
        'implicit_signal' | 'external_data' | 'human_confirmation'
  sourceId: string                        // campaignId, resultSetId, etc.
  metric: string                          // What was measured: "reply_rate", "icp_match_rate"
  value: number                           // The measured value
  sampleSize: number                      // How many data points
  timestamp: string
}

type IntelligenceSource =
  | 'rlhf'              // Table feedback (explicit)
  | 'campaign_outcome'  // Campaign performance data
  | 'ab_test'           // Controlled experiment result
  | 'implicit'          // Derived from user behavior patterns
  | 'external'          // From connected analytics tools
  | 'human_input'       // User explicitly told the OS
  | 'correction'        // User corrected the OS's assumption

interface BiasCheck {
  sampleSize: number                      // Minimum threshold: 30
  segmentBalance: boolean                 // Not over-indexed on one segment
  timeSpan: number                        // Days of data — single-day patterns are risky
  recencyWeighted: boolean                // Recent data weighted more than old
  checkedAt: string
}
```

### Intelligence Rules

1. **No intelligence without evidence.** Every insight must cite specific campaigns, feedback sessions, or data points.
2. **Confidence has thresholds.** Hypothesis: <30 evidence points or <7 days. Validated: 30-100 evidence points AND >14 days. Proven: >100 evidence points AND >30 days AND passed bias check.
3. **Intelligence can expire.** Timing patterns older than 90 days are demoted. Channel preferences older than 180 days are flagged for revalidation. Market intelligence expires in 30 days.
4. **Intelligence can be superseded.** When a new insight contradicts an old one with stronger evidence, the old one is marked superseded (kept for history, not injected into prompts).
5. **Segmentation is mandatory.** "Email works well" is not intelligence. "Email works well for Series B SaaS companies with 100-300 employees in DACH" is.
6. **Bias checks are required for promotion.** A hypothesis can become validated without a bias check. But promoted to proven requires: sample size >30, multi-segment data, time span >14 days, no single-day anomalies.

### Intelligence DB Table

```
intelligence:
  id (uuid PK)
  category (text — from IntelligenceCategory enum)
  insight (text)
  evidence (JSON — Evidence[])
  segment (text nullable)
  channel (text nullable)
  confidence (text — 'hypothesis' | 'validated' | 'proven')
  confidenceScore (integer — 0-100)
  source (text — from IntelligenceSource enum)
  biasCheck (JSON nullable — BiasCheck)
  supersedes (text nullable — FK to intelligence.id)
  createdAt (timestamp)
  validatedAt (timestamp nullable)
  expiresAt (timestamp nullable)
```

### How Intelligence Flows into Prompts

`buildFrameworkContext()` evolves:
- Injects top 5 **proven** intelligence items (any category) into system prompt
- Injects top 3 **validated** items relevant to the current query's segment/channel
- Hypotheses are NEVER injected into prompts — they're too noisy
- Each injected item includes its confidence score and evidence count so Claude can weight them

---

## System 1: Skills Engine

**What it does:** Every recurring task the OS performs is a standardized, composable Skill. The OS selects skills based on the hypothesis being tested, the intelligence it has, and the tools available.

**Why it matters:** Without skills, every task is ad-hoc. The OS can't learn which execution pattern works because there's no standardized pattern to learn about. Skills are what make campaigns repeatable, optimizable, and composable.

### What Is a Skill?

A Skill is a **named, versioned, self-contained GTM operation** with defined inputs, outputs, and execution logic. It's the unit of work the OS thinks in.

| Skill | Input | Output | Example |
|-------|-------|--------|---------|
| `find-companies` | ICP criteria, count, providers | resultSet with company rows | "Find 200 SaaS companies in France with 100+ employees" |
| `enrich-leads` | resultSetId, enrichment type | enriched rows added to resultSet | "Add email + LinkedIn for all rows" |
| `qualify-leads` | resultSetId, framework | scored rows | "Score against primary ICP segment" |
| `write-outreach-email` | lead data, template, personalization | email draft | "Write cold email for this CTO" |
| `write-outreach-sequence` | lead data, template, variants count | email sequence with A/B variants | "3-email sequence with 2 A/B tests per step" |
| `write-linkedin-post` | topic, angle, framework | post draft | "Write a LinkedIn post about compliance costs" |
| `write-reddit-post` | topic, subreddit, angle | post draft | "Write r/SaaS post about EOR challenges" |
| `research-prospect` | company domain or person name | research brief | "What does this company care about right now?" |
| `analyze-campaign` | campaignId | performance analysis + recommendations | "How is this campaign performing? What should change?" |
| `monitor-replies` | campaign channel config | reply notifications | "Check for new replies on this email sequence" |
| `export-data` | resultSetId, format | file | "Export qualified leads as CSV" |

### Skill Definition

```typescript
interface Skill {
  id: string                              // 'find-companies', 'write-outreach-email'
  name: string                            // Human-readable
  version: string                         // Semantic versioning
  description: string                     // What this skill does
  category: 'research' | 'content' | 'outreach' | 'analysis' | 'data' | 'integration'
  inputSchema: JSONSchema                 // What it needs
  outputSchema: JSONSchema                // What it produces
  requiredProviders: string[]             // Which providers it needs (or [] for provider-agnostic)
  estimatedCost: (input: unknown) => number  // Cost estimate based on input
  execute: (input: unknown, context: SkillContext) => AsyncIterable<SkillEvent>
}

interface SkillContext {
  framework: GTMFramework
  intelligence: Intelligence[]            // Relevant proven/validated intelligence
  providers: ProviderRegistry             // Available providers
  reviewQueue: ReviewQueue                // For requesting human approval
}

type SkillEvent =
  | { type: 'progress', message: string, percent: number }
  | { type: 'result', data: unknown }
  | { type: 'approval_needed', request: ReviewRequest }
  | { type: 'intelligence_signal', signal: Signal }
  | { type: 'error', message: string }
```

### Skill Registry

```typescript
class SkillRegistry {
  register(skill: Skill): void
  get(id: string): Skill | null
  list(category?: string): SkillMetadata[]
  resolve(intent: string, context: SkillContext): Skill[]  // AI-powered: match user intent to skills
  compose(skillIds: string[], config: CompositionConfig): ComposedSkill  // Chain skills into a pipeline
}
```

### How the OS Selects Skills

When Claude receives a user message, it doesn't just propose a workflow — it selects and composes skills:

```
User: "Run a cold email campaign to French SaaS CTOs with A/B testing"
                │
                ▼
PLANNER (Claude) — sees available skills in system prompt
                │
                ├─ Selects: find-companies → enrich-leads → qualify-leads
                │           → write-outreach-sequence (with A/B) → [human review]
                │           → send-outreach → monitor-replies → analyze-campaign
                │
                ├─ Configures each skill with specific inputs based on intelligence:
                │   "Intelligence says 100-300 employees converts best for DACH SaaS"
                │   → find-companies.input.filters.employeeRange = [100, 300]
                │
                └─ Proposes this as a Campaign (hypothesis)
```

### Skill ↔ Provider Relationship

Skills are provider-agnostic. `find-companies` doesn't know about Apollo or Hunter — it declares "I need a provider with capability 'search'" and the Provider Registry resolves it. This means:
- Same skill works whether user has Apollo key, Hunter MCP, or mock data
- Provider Intelligence influences which provider a skill uses, not the skill itself
- New providers automatically work with existing skills

### Integration Points

- **Consumed by:** Campaign Manager (composes skills into campaigns), Planner (proposes skill compositions)
- **Uses:** Provider Registry (resolves providers per skill), Intelligence (configures skill inputs)
- **Emits:** intelligence_signal events → Learning Loop

---

## System 2: Campaign Manager

**What it does:** Orchestrates campaigns — which are **hypotheses being tested** — across channels and over time.

**Why it matters:** A campaign is not a to-do list. It's: "We believe X works for segment Y via channel Z. Here's how we'll test that. Here's the approval gate. Here's how we'll measure."

### Campaign = Hypothesis

```typescript
interface Campaign {
  id: string
  conversationId: string                  // The chat that spawned it
  title: string
  hypothesis: string                      // "Pain-point messaging about compliance costs converts
                                          //  mid-market CFOs in DACH via LinkedIn InMail"
  status: CampaignStatus
  targetSegment: string                   // ICPSegment.name
  channels: string[]                      // ['email', 'linkedin', 'reddit']
  successMetrics: SuccessMetric[]         // How we measure if hypothesis is true
  schedule: CampaignSchedule
  steps: CampaignStep[]
  metrics: CampaignMetrics                // Live metrics
  verdict: HypothesisVerdict | null       // Set when campaign completes
  createdAt, updatedAt: string
}

interface SuccessMetric {
  metric: string                          // 'reply_rate', 'demo_booked_rate', 'conversion_rate'
  target: number                          // What we consider success: e.g., 0.15 (15%)
  baseline: number | null                 // What we've seen before (from intelligence)
  actual: number | null                   // Measured result
}

type HypothesisVerdict =
  | { result: 'confirmed', evidence: string, newIntelligence: Intelligence[] }
  | { result: 'disproven', evidence: string, newIntelligence: Intelligence[] }
  | { result: 'inconclusive', reason: string, suggestedFollowUp: string }

type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'completed' | 'failed'
```

### Campaign Steps = Skill Compositions

Each step in a campaign is a **skill execution** with dependencies and approval gates:

```typescript
interface CampaignStep {
  id: string
  campaignId: string
  stepIndex: number
  skillId: string                         // Which skill to execute
  skillInput: Record<string, unknown>     // Configured input for this skill
  channel: string | null
  status: StepStatus
  dependsOn: string[]                     // Step IDs that must complete first
  approvalRequired: boolean               // Pause and ask human before executing?
  resultSetId: string | null              // If this step produces data
  scheduledAt: string | null
  completedAt: string | null
}

type StepStatus = 'pending' | 'waiting_approval' | 'approved' | 'running' |
                  'completed' | 'failed' | 'skipped'
```

### Campaign Content

Every piece of content the OS generates lives here with its full lifecycle:

```typescript
interface CampaignContent {
  id: string
  campaignId: string
  stepId: string
  contentType: 'email' | 'linkedin_message' | 'linkedin_post' | 'reddit_post' |
               'reddit_comment' | 'follow_up' | 'ad_copy'
  targetLeadId: string | null             // Which lead this is for (null for content posts)
  content: string                         // The actual text
  variant: string | null                  // 'A' | 'B' | 'C' for A/B tests
  status: ContentStatus
  personalizationData: Record<string, unknown>
  metrics: ContentMetrics
}

type ContentStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'sent' | 'failed'

interface ContentMetrics {
  sentAt: string | null
  openedAt: string | null
  clickedAt: string | null
  repliedAt: string | null
  convertedAt: string | null              // Booked demo, signed up, etc.
  bouncedAt: string | null
}
```

### Campaign Lifecycle

```
DRAFT → PLANNING → ACTIVE → COMPLETED
           │          ↑ ↓        │
           │          PAUSED     ▼
           │                  VERDICT
           │                (confirmed / disproven / inconclusive)
           │                     │
           │                     ▼
           │              New Intelligence generated
           │              (feeds back into OS)
           ▼
    Steps execute in dependency order
    Each step: skill.execute() → emit signals → check approval gates
    Content steps: generate → human review → approve → send → track
```

### External Tool Connections (Performance Data)

The OS must pull campaign performance data from where the campaigns actually run. Three integration paths:

| Path | When | Tools | How |
|------|------|-------|-----|
| **MCP/API** | Tool has MCP server or API | HeyReach, Lemlist, Instantly, Social Pilot | Connect via MCP client (Day 4) or direct API. Auto-sync metrics. |
| **Webhook** | Tool supports webhooks | Most modern sequencers | Tool pushes events (open, reply, bounce) to `/api/webhooks/campaign-events` |
| **Human snapshot** | No API/MCP available | Manual tools, early stage | Human pastes/uploads a performance snapshot. OS parses it. |

```typescript
interface ExternalDataSource {
  id: string
  name: string                            // "Instantly", "HeyReach", "Social Pilot"
  type: 'mcp' | 'api' | 'webhook' | 'manual_snapshot'
  connectionConfig: Record<string, unknown>
  syncFrequency: 'realtime' | 'hourly' | 'daily' | 'manual'
  lastSyncAt: string | null
  status: 'connected' | 'disconnected' | 'error'
  metricsMapping: MetricsMapping          // Maps external fields to our metrics schema
}

interface MetricsMapping {
  // Maps external tool field names to standard metrics
  sent: string        // e.g., "email_sent_count" in Instantly
  opened: string      // e.g., "opens" in Lemlist
  replied: string
  converted: string
  bounced: string
}
```

### Content Analytics Connections

For content campaigns (LinkedIn, Reddit, etc.), the OS needs reach/engagement data:

| Platform | Integration | Data pulled |
|----------|------------|-------------|
| LinkedIn | Social Pilot MCP/API (if connected) OR manual | Impressions, reactions, comments, shares, profile views |
| Reddit | Apify scraping (existing infrastructure) | Upvotes, comments, removal status |
| Blog/SEO | Google Search Console API or manual | Rankings, clicks, impressions |
| Twitter/X | API or manual | Impressions, engagements, follows |

When no API is connected, the OS presents a **snapshot upload form**: "Paste your LinkedIn post analytics for the last 7 days" → OS parses and ingests.

### Integration Points

- **Uses:** Skills Engine (each step is a skill execution), Provider Registry (for sending), Web Intelligence (for research steps), Human Review (approval gates)
- **Emits:** Campaign outcome signals → Intelligence system, Review requests → Human Review
- **Reads:** Intelligence (to configure skills, set success baselines)
- **Writes:** campaign_content metrics → feeds back into Intelligence

### Contract

- Human Review: Every content step is an approval gate by default. Campaign pauses. Human approves/edits/rejects each piece.
- Intelligence: On campaign completion, the OS generates a verdict (confirmed/disproven/inconclusive) and creates new Intelligence entries from the results.
- Skills Engine: Campaign steps map 1:1 to skill executions. The Campaign Manager is an orchestrator, not an executor.

---

## System 3: Data Quality Monitor

**What it does:** Ensures lead data stays accurate, deduplicated, and fresh. Nudges the human when action is needed.

### Capabilities

| Check | Trigger | Nudge |
|-------|---------|-------|
| **Deduplication** | New rows inserted | "Found 15 duplicates from Campaign X. Merge and use the most recent data? [Yes / Show me]" |
| **Email decay** | Weekly scan | "8 emails in Campaign Y bounced since last check. Re-enrich these 8 leads? [Yes / Skip / Pause campaign]" |
| **Completeness** | On resultSet creation | "12 rows are missing email addresses. Enrich with Hunter? Estimated cost: $0.24 [Yes / No]" |
| **Anomaly** | On batch generation | "ICP match rate dropped to 8% (usually 35%). Your search criteria may be too broad. Here's what changed: [View analysis]" |
| **Freshness** | On resultSet access | Badge: "Last enriched 45 days ago" + "Re-enrich? [Yes]" |
| **Cross-campaign overlap** | Campaign creation | "Campaign Z targets 60% of the same companies as Campaign Y. Exclude overlap? [Yes / Include anyway]" |

Every nudge is specific: what's wrong, why it matters, what to do about it, and a one-click action.

### Data Model

```
data_quality_log:
  id (uuid PK)
  resultSetId (FK)
  rowId (FK nullable)
  checkType (text)
  severity ('info' | 'warning' | 'critical')
  details (JSON)
  nudge (text — the human-readable recommendation)
  action (JSON — { endpoint, method, body } for one-click resolution)
  resolved (boolean default false)
  resolvedAt (timestamp nullable)
  createdAt (timestamp)
```

---

## System 4: Campaign Optimization (Nudge Engine)

**What it does:** Continuously analyzes campaign performance and **nudges** the human with specific, evidence-backed recommendations. Never surface-level. Always actionable.

**Key principle:** The OS does NOT auto-apply optimizations. It does NOT just queue approvals passively. It **nudges** — presents a specific recommendation with the data, the reasoning, and a one-click action. The human's decision is trivially easy: yes, no, or tell me more.

### What Makes a Good Nudge

A nudge must be:
- **Specific:** Not "improve your targeting." Instead: "Narrow employee range from 50-500 to 100-300."
- **Evidence-backed:** "Based on 847 sends across 3 campaigns, 100-300 employees converts at 4.2x the rate."
- **Actionable:** "Apply this filter to your current campaign? [Yes / No / Show data]"
- **Reasoned:** "Why: your current campaign targets 50-500 but 73% of conversions came from the 100-300 band. The 50-100 band has a 2% conversion rate vs 8.4% for 100-300."
- **Scoped:** Tells you exactly what will change and what won't.

### Nudge Types

| Category | Example Nudge |
|----------|--------------|
| **Audience** | "Segment X has 12% reply rate vs 34% for Y. Reallocate 60% of remaining volume to Y? Here's the projected impact: +14 replies. [Apply / Ignore / Show breakdown]" |
| **Content** | "Template A gets 2.1x more replies than B for this segment. Stop sending B and use A's structure? [Apply / Keep A/B running / Show templates side by side]" |
| **Timing** | "Open rate is 41% on Tuesday 9-11am vs 18% average. Schedule remaining sends for Tuesday mornings? [Apply / Ignore]" |
| **Channel** | "LinkedIn InMail outperforms cold email by 2.3x for CTOs in your pipeline. Shift 30% of volume to LinkedIn? Cost impact: +$45/month on InMail credits. [Apply / Ignore / Show data]" |
| **Volume** | "After 100 emails to DACH SaaS segment, reply rate dropped from 8% to 3%. Diminishing returns detected. Pause this segment and move to Nordics? [Pause / Continue / Show curve]" |
| **ICP** | "Companies with React + Node.js in their stack convert at 4.2x. Your current filter doesn't include tech stack. Add this filter? Estimated impact: -40% volume, +3.8x conversion. [Apply / Ignore / Show leads affected]" |
| **A/B verdict** | "After 200 sends per variant, Subject A ('Your compliance costs are 3x too high') beats B ('Reduce compliance overhead') by 67%. Statistical significance: 95%. Declare A the winner and stop B? [Yes / Need more data]" |
| **Campaign health** | "Campaign X has been running for 14 days with a 2.1% reply rate (target: 10%). At current trajectory, you'll reach 4.2% by end. Consider: (1) change messaging angle, (2) narrow ICP, (3) switch channel. [See recommendations / Pause campaign]" |

### Architecture

```
NUDGE ENGINE
  │
  ├─ INPUT: campaign metrics, intelligence, historical campaigns
  │
  ├─ ANALYSIS (Claude — on-demand or scheduled)
  │   ├─ Compare current metrics vs success targets
  │   ├─ Compare current metrics vs historical benchmarks (from intelligence)
  │   ├─ Detect: underperformance, A/B winners, diminishing returns, anomalies
  │   ├─ For each finding: generate specific nudge with evidence + action
  │   │
  │   └─ OUTPUT: Nudge[]
  │       {
  │         category, insight, recommendation, evidence,
  │         impact: { metric, currentValue, projectedValue, confidence },
  │         action: { endpoint, method, body },  // One-click apply
  │         alternatives: Nudge[],                // Other options
  │         showDataEndpoint: string              // "Show me the data" link
  │       }
  │
  └─ DELIVERY: via Human Review System (nudge = review request with priority + evidence)
```

### Contract

- Nudges are delivered through the Human Review System — they're a special type of review request with richer payload (evidence, projected impact, alternatives).
- When a nudge is approved and applied, the action becomes a new Intelligence entry with source='campaign_outcome'.
- The engine can be triggered on-demand ("analyze this campaign") or scheduled (daily for active campaigns).
- Any agent in the system can trigger the nudge engine for a campaign — it's not limited to a cron job.

---

## System 5 + 8: Human Review System (unified)

**What it does:** The single interface for all human-in-the-loop interactions. Approval gates, nudges, escalations, and direct pings — all flow through one queue.

**Design principle:** Make saying yes or no trivially easy. Every review item shows: what happened, why it matters, what the OS recommends, and a one-click action. The human should spend 5 seconds per item, not 5 minutes.

### Review Request Types

| Type | Source | Example |
|------|--------|---------|
| `content_review` | Campaign Manager | "Review 15 email drafts. 3 flagged for tone." |
| `campaign_gate` | Campaign Manager | "Move to follow-up phase? 12 of 60 replied." |
| `nudge` | Optimization Engine | "Narrow ICP to 100-300 employees? +3.8x projected conversion." |
| `intelligence` | Learning Loop | "New pattern: React companies convert 4.2x. Confirm?" |
| `data_quality` | Data Monitor | "8 emails bounced. Re-enrich? [Yes / Pause campaign]" |
| `anomaly` | Any system | "ICP match rate dropped to 8%. Something changed." |
| `escalation` | Any system | "API rate limit hit. Campaign paused." |
| `snapshot_request` | Campaign Manager | "Need LinkedIn analytics for last 7 days. [Upload snapshot]" |

### Data Model

```
review_queue:
  id (uuid PK)
  type (text)
  title (text — one-line summary)
  description (text — full context)
  sourceSystem (text)
  sourceId (text)
  priority ('low' | 'normal' | 'high' | 'urgent')
  status ('pending' | 'approved' | 'rejected' | 'dismissed' | 'expired')
  payload (JSON — type-specific: drafts, evidence, recommendations)
  action (JSON — { endpoint, method, body } for one-click apply)
  nudgeEvidence (JSON nullable — for nudge type: metrics, projections, alternatives)
  reviewedAt (timestamp nullable)
  reviewNotes (text nullable)
  expiresAt (timestamp nullable)
  createdAt (timestamp)

notification_preferences:
  id (uuid PK)
  channel ('in_app' | 'email' | 'slack' | 'webhook')
  config (JSON)
  minPriority ('low' | 'normal' | 'high' | 'urgent')
  enabled (boolean)
```

### UI Surfaces

- **Sidebar badge:** Count of pending reviews (color-coded by priority)
- **Review page (`/reviews`):** Filterable queue, one-click approve/reject per item
- **Chat integration:** Urgent items surface as system messages
- **Table integration:** Content reviews use the same row-level approve/reject pattern from RLHF
- **Nudge cards:** Rich cards showing evidence, projected impact, alternatives — designed for 5-second decisions

---

## System 6: Web Intelligence

**What it does:** Fetches and analyzes real-time web data to enrich leads, research prospects, and validate content.

### When It's Used

| Trigger | What happens |
|---------|-------------|
| Campaign content generation step | Research each prospect's website, blog, recent news before drafting |
| Lead enrichment step | Scrape company pages for tech stack, team size, product details |
| Campaign planning | Search for trigger events (funding, hiring, product launches) |
| Competitive monitoring | Weekly scan of competitor domains for changes |
| Content validation | Before approving content, fact-check claims and references |

### Architecture

```
WEB INTELLIGENCE
    │
    ├─ FETCH (provider-agnostic, via Provider Registry)
    │   ├─ Firecrawl MCP (if connected)
    │   ├─ Search MCP (if connected)
    │   └─ Built-in: fetch + HTML-to-markdown
    │
    ├─ ANALYZE (Claude)
    │   Input: raw web content + research question
    │   Output: structured WebInsight
    │
    └─ CACHE
        ├─ web_cache (URL → content, TTL-based)
        └─ TTL: 24h news, 7d company pages, 30d tech stack
```

### Data Model

```
web_cache:
  id (uuid PK)
  url (text unique)
  content (text — markdown)
  contentType (text)
  extractedInsights (JSON)
  fetchedAt, expiresAt (timestamps)

web_research_tasks:
  id (uuid PK)
  targetType (text)
  targetIdentifier (text)
  status (text)
  results (JSON)
  requestedBy (text)
  createdAt, completedAt (timestamps)
```

---

## System 7: Provider Intelligence

**What it does:** The OS actively selects which provider to use for each task based on performance data, cost, and intelligence — not just availability.

### How It Works

When any skill needs a provider, it doesn't just get "the first available one." It gets the BEST one for this specific context:

```
Skill: find-companies
Context: DACH SaaS, 100-300 employees
Budget: $50 max

PROVIDER INTELLIGENCE
  ├─ Apollo: 78% accuracy for EU, $0.02/lead, 200ms avg
  ├─ Hunter: 45% accuracy for EU, $0.01/lead, 150ms avg
  ├─ Intelligence: "Apollo returns 23% more valid emails for European companies"
  │
  └─ Decision: Apollo
     Reason: "Higher accuracy for EU companies. 78% vs 45% (validated intelligence).
              Cost is within budget ($4.00 for 200 leads)."
```

### Data Model

```
provider_stats:
  id (uuid PK)
  providerId (text)
  metric (text — 'accuracy' | 'latency_ms' | 'cost_per_call' | 'coverage')
  value (real)
  sampleSize (integer)
  segment (text nullable)
  measuredAt (timestamp)

provider_preferences:
  id (uuid PK)
  skillId (text — which skill this preference applies to)
  segment (text nullable)
  preferredProvider (text)
  reason (text)
  source ('auto' | 'user' | 'intelligence')
  createdAt (timestamp)
```

Stats are collected automatically after every skill execution: compare output quality against ICP criteria, measure latency, track cost.

---

## System 8: Continuous Learning Loop

**What it does:** Passively accumulates intelligence from every interaction. Not just explicit RLHF sessions — every user action is signal.

### Signal Sources

| Signal | Source | Intelligence it feeds |
|--------|--------|----------------------|
| RLHF feedback | Table UI | Qualification intelligence |
| Campaign outcomes | Campaign metrics | Content, channel, timing intelligence |
| A/B test results | Campaign content variants | Content intelligence |
| Workflow edits | Chat | Qualification, campaign intelligence |
| Human corrections | Chat, review queue | All categories |
| Provider performance | Execution engine | Provider intelligence |
| External analytics | Connected tools | Channel, content intelligence |
| Human snapshots | Manual upload | Channel, content intelligence |

### Architecture

```
SIGNAL COLLECTOR (passive, every interaction)
    │
    └─ signals_log table (raw signals with metadata)
          │
          ▼
    PATTERN DETECTOR (Claude, batch — daily or on-threshold)
    ├─ Groups signals by category + segment
    ├─ Compares against existing intelligence
    ├─ Proposes new Intelligence entries OR upgrades confidence of existing
    │
    └─ Two paths:
        ├─ Hypothesis (low evidence) → saved silently, not injected into prompts
        └─ Validated/Proven → nudge human for confirmation via Review System
```

### Data Model

```
signals_log:
  id (uuid PK)
  type (text — signal type enum)
  category (text — maps to IntelligenceCategory)
  data (JSON — signal-specific payload)
  conversationId, resultSetId, campaignId (FKs, all nullable)
  createdAt (timestamp)
```

### Integration

- **Every system emits signals.** Campaign outcomes, RLHF feedback, provider performance, human corrections — all write to signals_log.
- **Pattern detector outputs Intelligence entries.** These flow into `buildFrameworkContext()` and influence every future Claude call.
- **The loop is: signals → patterns → intelligence → better decisions → more signals.**

---

## New Database Tables Summary

| Table | System | Purpose |
|-------|--------|---------|
| intelligence | Core | Structured, segmented, evidence-backed insights |
| signals_log | Learning Loop | Raw interaction signals |
| campaigns | Campaign Manager | Campaign hypothesis + lifecycle |
| campaign_steps | Campaign Manager | Skill-based steps with dependencies |
| campaign_content | Campaign Manager | Content drafts with per-piece metrics |
| external_data_sources | Campaign Manager | Connections to sequencers + analytics tools |
| data_quality_log | Data Monitor | Quality check results + nudges |
| review_queue | Human Review | Universal approval/nudge queue |
| notification_preferences | Human Review | Notification routing config |
| web_cache | Web Intelligence | Cached web content with TTL |
| web_research_tasks | Web Intelligence | Research request tracking |
| provider_stats | Provider Intelligence | Per-provider performance metrics |
| provider_preferences | Provider Intelligence | Best provider per skill + segment |

---

## Dependency Graph (Build Order)

```
WEEK 1 (Days 1-4): FOUNDATION — done/planned
  Day 1: Chat + Workflow Planner
  Day 2: Framework + Onboarding + Design
  Day 3: Tables + Execution + RLHF
  Day 4: Provider Registry + MCP

WEEK 2 (Days 5-9): SKILLS + HUMAN + CAMPAIGNS
  Day 5:  Skills Engine
          → Skill interface, registry, built-in skills (find-companies, enrich, qualify)
          → Replaces ad-hoc execution with standardized skill invocations
          → WHY FIRST: campaigns are compositions of skills

  Day 6:  Human Review System + Nudge delivery
          → review_queue, notification_preferences
          → Review page UI, sidebar badge, nudge cards
          → WHY SECOND: campaigns can't run without approval gates

  Day 7:  Web Intelligence
          → web_cache, web_research_tasks
          → Fetch + analyze + cache layer
          → WHY THIRD: campaigns need prospect research for content

  Days 8-10: Campaign Manager
          → campaigns, campaign_steps, campaign_content, external_data_sources
          → Campaign = hypothesis. Steps = skill compositions.
          → Content generation + A/B variants
          → External tool connections (HeyReach, Lemlist, Instantly, Social Pilot)
          → Human snapshot upload for tools without APIs
          → WHY 3 DAYS: largest system, ties everything together

WEEK 3 (Days 11-14): INTELLIGENCE + OPTIMIZATION
  Day 11: Intelligence system
          → intelligence table, confidence engine, bias checks
          → Replace flat Learning[] with structured Intelligence system
          → Wire into buildFrameworkContext()
          → WHY HERE: needs campaign data to be meaningful

  Day 12: Continuous Learning Loop
          → signals_log, pattern detector
          → Wire signal collection into every system
          → Auto-derive hypotheses, nudge for confirmations

  Day 13: Provider Intelligence
          → provider_stats, provider_preferences
          → Post-execution stat collection, decision matrix
          → WHY HERE: needs execution history

  Day 14: Campaign Optimization (Nudge Engine)
          → Specific, evidence-backed, actionable nudges
          → A/B test verdict engine
          → Campaign health monitoring

WEEK 3-4 (Days 15-18): DATA + QUALITY
  Day 15: Data Quality Monitor
          → data_quality_log, dedup, completeness, decay
          → Nudge-based data hygiene

  Days 16-18: Content skills expansion
          → write-outreach-sequence (with A/B)
          → write-linkedin-post, write-reddit-post
          → Skill versions, skill composition patterns

WEEKS 4-5 (Days 19-30): POLISH + SCALE
  Day 19-20: Dashboard (aggregate view)
  Day 21-22: Knowledge Base UI
  Day 23-24: External notifications (Slack, email, webhook)
  Day 25-26: Export + CRM integrations
  Day 27-28: Settings + preferences
  Day 29-30: Polish, docs, launch prep
```

---

## Shared Contracts

### 1. Intelligence Contract

Any system that produces intelligence uses this interface:

```typescript
interface IntelligenceInput {
  category: IntelligenceCategory
  insight: string
  evidence: Evidence[]
  segment: string | null
  channel: string | null
  source: IntelligenceSource
}
// Intelligence system handles: dedup, confidence scoring, bias checking, storage
```

### 2. Nudge Contract

Any system that needs to nudge the human:

```typescript
interface Nudge {
  category: string
  insight: string                         // What the OS noticed
  recommendation: string                  // What the OS suggests
  evidence: { metric: string, value: number, comparison: number, source: string }[]
  impact: { metric: string, current: number, projected: number, confidence: number }
  action: { endpoint: string, method: string, body: unknown }
  alternatives: Nudge[]
  showDataEndpoint: string
}
// Delivered via Human Review System
```

### 3. Skill Execution Contract

Any system that needs to do work:

```typescript
interface SkillRequest {
  skillId: string
  input: Record<string, unknown>
  context: {
    campaignId?: string
    segment?: string
    budgetLimit?: number
    intelligence: Intelligence[]           // Relevant intelligence for this context
  }
}
// Returns AsyncIterable<SkillEvent>
```

### 4. Signal Contract

Any system that generates learning signals:

```typescript
interface Signal {
  type: string
  category: IntelligenceCategory
  data: Record<string, unknown>
  conversationId?: string
  campaignId?: string
  resultSetId?: string
}
// Written to signals_log
```

---

## Design Principles

1. **Intelligence is the product.** Every system contributes to and consumes intelligence. Intelligence is structured, segmented, evidence-backed, and bias-checked.

2. **Campaigns are hypotheses.** They have a thesis, success metrics, a verdict, and they generate intelligence regardless of outcome. A failed campaign is a successful learning.

3. **Skills are the atoms.** Every action is a skill. Skills are composable, provider-agnostic, and measurable. New capabilities = new skills.

4. **Nudge, don't block.** The OS presents specific, evidence-backed recommendations with one-click actions. The human spends 5 seconds deciding, not 5 minutes investigating.

5. **Specificity over generality.** "Narrow to 100-300 employees, projected +3.8x conversion based on 847 data points" beats "consider refining your ICP."

6. **Every loop closes.** Signals → patterns → intelligence → better decisions → more signals. Campaign results → intelligence → better campaigns. Human corrections → adjusted behavior → fewer corrections needed.

7. **Graceful degradation.** No API? Use mock data. No analytics connection? Accept human snapshots. No MCP? Fall back to built-in. The OS always works, just better with more connections.

8. **Contracts over implementations.** Systems communicate through Intelligence, Nudge, Skill, and Signal contracts. Implementations change independently.
