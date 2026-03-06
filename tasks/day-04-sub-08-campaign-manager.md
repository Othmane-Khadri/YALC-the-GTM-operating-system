# Sub-Brief 4.8 — Campaign Manager (Part 1: Core + Planning)

**Goal:** Build the campaign orchestration system. A campaign is a hypothesis with steps that compose skills. Part 1 covers: data model, campaign creation via chat, campaign page, step management. Part 2 (content generation + sending) is a future sub-brief.

---

## Read These Files First

Read every file listed below before writing any code. Understand the current shapes, imports, and patterns.

1. `src/lib/skills/types.ts` — Skill interface (from 4.4) — campaigns compose skills
2. `src/lib/skills/registry.ts` — SkillRegistry (from 4.4) — resolving skills by ID
3. `src/lib/review/queue.ts` — ReviewQueue (from 4.6) — approval gates create review requests
4. `src/lib/intelligence/store.ts` — IntelligenceStore (from 4.5) — campaign verdicts feed back as intelligence
5. `src/lib/db/schema.ts` — current tables (including review_queue, intelligence from 4.5/4.6)
6. `src/lib/ai/workflow-planner.ts` — current planner (we are extending with campaign proposals)
7. `src/components/chat/ChatPanel.tsx` — chat integration (handling tool results)
8. `src/components/chat/MessageBubble.tsx` — message rendering (adding campaign proposal rendering)
9. `docs/SYSTEMS_ARCHITECTURE.md` — Campaign Manager section

---

## New Files to Create

### `src/lib/campaign/types.ts`

All campaign-system types. No runtime logic, only types and interfaces.

```ts
// CampaignStatus — lifecycle of a campaign
export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'completed' | 'failed';

// StepStatus — lifecycle of a single campaign step
export type StepStatus =
  | 'pending'
  | 'waiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

// ContentStatus — lifecycle of generated content
export type ContentStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'sent' | 'failed';

// SuccessMetric — a measurable outcome the campaign is testing
export interface SuccessMetric {
  metric: string;              // e.g. 'reply_rate', 'meetings_booked', 'leads_qualified'
  target: number;              // the goal
  baseline: number | null;     // previous performance (null if first campaign)
  actual: number | null;       // measured result (null while running)
}

// HypothesisVerdict — the conclusion after a campaign completes
export interface HypothesisVerdict {
  result: 'confirmed' | 'disproven' | 'inconclusive';
  evidence: string;            // human-readable summary of what the data showed
  newIntelligence?: unknown[]; // intelligence entries to create from this campaign
}

// Campaign — the core entity
export interface Campaign {
  id: string;
  conversationId: string;      // FK to the chat conversation that created it
  title: string;
  hypothesis: string;          // the thesis being tested
  status: CampaignStatus;
  targetSegment: string | null;
  channels: string[];          // e.g. ['email', 'linkedin']
  successMetrics: SuccessMetric[];
  steps: CampaignStep[];
  metrics: CampaignMetrics;
  verdict: HypothesisVerdict | null;
  createdAt: string;
  updatedAt: string;
}

// CampaignStep — one step in the campaign pipeline
export interface CampaignStep {
  id: string;
  campaignId: string;
  stepIndex: number;
  skillId: string;             // references Skill.id from the skills registry
  skillInput: Record<string, unknown>;
  channel: string | null;
  status: StepStatus;
  dependsOn: string[];         // IDs of steps that must complete first
  approvalRequired: boolean;
  resultSetId: string | null;  // FK to resultSets table if this step produced data
  scheduledAt: string | null;
  completedAt: string | null;
}

// CampaignContent — generated content for a specific lead/target
export interface CampaignContent {
  id: string;
  campaignId: string;
  stepId: string;
  contentType: string;         // e.g. 'email', 'linkedin_message', 'linkedin_post'
  targetLeadId: string | null; // FK to a specific lead row
  content: string;             // the actual content text
  variant: string | null;      // A/B test variant label
  status: ContentStatus;
  personalizationData: Record<string, unknown>;
  metrics: ContentMetrics;
}

// ContentMetrics — engagement tracking for a single content piece
export interface ContentMetrics {
  sentAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  repliedAt: string | null;
  convertedAt: string | null;
  bouncedAt: string | null;
}

// CampaignMetrics — aggregate metrics for the entire campaign
export interface CampaignMetrics {
  totalLeads: number;
  qualified: number;
  contentGenerated: number;
  sent: number;
  opened: number;
  replied: number;
  converted: number;
  bounced: number;
}
```

---

### `src/lib/campaign/manager.ts`

The `CampaignManager` class. Orchestrates campaign lifecycle, step execution, and approval gates.

```ts
import { randomUUID } from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { campaigns, campaignSteps, campaignContent } from '../db/schema';
import { ReviewQueue } from '../review/queue';
import type {
  Campaign,
  CampaignStatus,
  CampaignStep,
  CampaignMetrics,
  HypothesisVerdict,
  StepStatus,
  SuccessMetric,
} from './types';

interface CreateParams {
  conversationId: string;
  title: string;
  hypothesis: string;
  targetSegment: string | null;
  channels: string[];
  successMetrics: SuccessMetric[];
}

interface AddStepParams {
  stepIndex: number;
  skillId: string;
  skillInput: Record<string, unknown>;
  channel?: string | null;
  dependsOn?: string[];
  approvalRequired?: boolean;
}

const reviewQueue = new ReviewQueue();

export class CampaignManager {
  /**
   * Create a new campaign.
   */
  async create(params: CreateParams): Promise<Campaign> {
    const id = randomUUID();
    const now = new Date().toISOString();

    const emptyMetrics: CampaignMetrics = {
      totalLeads: 0, qualified: 0, contentGenerated: 0,
      sent: 0, opened: 0, replied: 0, converted: 0, bounced: 0,
    };

    await db.insert(campaigns).values({
      id,
      conversationId: params.conversationId,
      title: params.title,
      hypothesis: params.hypothesis,
      status: 'draft',
      targetSegment: params.targetSegment,
      channels: JSON.stringify(params.channels),
      successMetrics: JSON.stringify(params.successMetrics),
      metrics: JSON.stringify(emptyMetrics),
      verdict: null,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id,
      conversationId: params.conversationId,
      title: params.title,
      hypothesis: params.hypothesis,
      status: 'draft',
      targetSegment: params.targetSegment,
      channels: params.channels,
      successMetrics: params.successMetrics,
      steps: [],
      metrics: emptyMetrics,
      verdict: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a campaign by ID, including its steps.
   */
  async get(id: string): Promise<Campaign | null> {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);

    if (rows.length === 0) return null;

    const steps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, id));

    return this.deserializeCampaign(rows[0], steps);
  }

  /**
   * List campaigns, optionally filtered by status.
   */
  async list(status?: CampaignStatus): Promise<Campaign[]> {
    const query = status
      ? db.select().from(campaigns).where(eq(campaigns.status, status))
      : db.select().from(campaigns);

    const rows = await query.orderBy(desc(campaigns.updatedAt));

    // Batch-load steps for all campaigns
    const result: Campaign[] = [];
    for (const row of rows) {
      const steps = await db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, row.id));
      result.push(this.deserializeCampaign(row, steps));
    }

    return result;
  }

  /**
   * Add a step to a campaign.
   */
  async addStep(campaignId: string, step: AddStepParams): Promise<CampaignStep> {
    const id = randomUUID();

    const entry: CampaignStep = {
      id,
      campaignId,
      stepIndex: step.stepIndex,
      skillId: step.skillId,
      skillInput: step.skillInput,
      channel: step.channel ?? null,
      status: 'pending',
      dependsOn: step.dependsOn ?? [],
      approvalRequired: step.approvalRequired ?? true,
      resultSetId: null,
      scheduledAt: null,
      completedAt: null,
    };

    await db.insert(campaignSteps).values({
      id,
      campaignId,
      stepIndex: entry.stepIndex,
      skillId: entry.skillId,
      skillInput: JSON.stringify(entry.skillInput),
      channel: entry.channel,
      status: 'pending',
      dependsOn: JSON.stringify(entry.dependsOn),
      approvalRequired: entry.approvalRequired ? 1 : 0,
      resultSetId: null,
      scheduledAt: null,
      completedAt: null,
    });

    // Update campaign timestamp
    await db
      .update(campaigns)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, campaignId));

    return entry;
  }

  /**
   * Update a step's status.
   */
  async updateStepStatus(stepId: string, status: StepStatus): Promise<void> {
    const updates: Record<string, unknown> = { status };
    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      updates.completedAt = new Date().toISOString();
    }

    await db
      .update(campaignSteps)
      .set(updates)
      .where(eq(campaignSteps.id, stepId));
  }

  /**
   * Execute a campaign step.
   * Resolves the skill from the registry, runs it, and creates an approval gate if needed.
   */
  async executeStep(campaignId: string, stepId: string): Promise<void> {
    const campaign = await this.get(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const step = campaign.steps.find(s => s.id === stepId);
    if (!step) throw new Error(`Step ${stepId} not found in campaign ${campaignId}`);

    // Check dependencies
    for (const depId of step.dependsOn) {
      const depStep = campaign.steps.find(s => s.id === depId);
      if (depStep && depStep.status !== 'completed') {
        throw new Error(`Dependency step ${depId} has not completed (status: ${depStep?.status})`);
      }
    }

    // If approval is required and step hasn't been approved yet, create a review request
    if (step.approvalRequired && step.status === 'pending') {
      await this.updateStepStatus(stepId, 'waiting_approval');

      await reviewQueue.create({
        type: 'campaign_gate',
        title: `Approve: ${campaign.title} — Step ${step.stepIndex + 1} (${step.skillId})`,
        description: `Campaign "${campaign.title}" needs approval to run step ${step.stepIndex + 1}.\n\nSkill: ${step.skillId}\nChannel: ${step.channel ?? 'N/A'}\nHypothesis: ${campaign.hypothesis}`,
        sourceSystem: 'campaign_manager',
        sourceId: campaignId,
        priority: 'high',
        payload: { campaignId, stepId, skillId: step.skillId, stepIndex: step.stepIndex },
        action: {
          endpoint: `/api/campaigns/${campaignId}/steps/${stepId}/execute`,
          method: 'POST',
          body: { approved: true },
        },
        nudgeEvidence: null,
        reviewedAt: null,
        reviewNotes: null,
        expiresAt: null,
      });

      return;
    }

    // Run the skill
    await this.updateStepStatus(stepId, 'running');

    try {
      // Dynamic import to avoid circular deps
      const { getSkillRegistry } = await import('../skills/registry');
      const skillRegistry = getSkillRegistry();
      const skill = skillRegistry.get(step.skillId);

      if (!skill) {
        throw new Error(`Skill "${step.skillId}" not found in registry`);
      }

      const result = await skill.execute(step.skillInput);

      // If the skill returned a result set ID, link it
      if (result?.resultSetId) {
        await db
          .update(campaignSteps)
          .set({ resultSetId: result.resultSetId })
          .where(eq(campaignSteps.id, stepId));
      }

      await this.updateStepStatus(stepId, 'completed');

      // Update campaign status to active if it was draft/planning
      if (campaign.status === 'draft' || campaign.status === 'planning') {
        await db
          .update(campaigns)
          .set({ status: 'active', updatedAt: new Date().toISOString() })
          .where(eq(campaigns.id, campaignId));
      }
    } catch (err: any) {
      console.error(`[CampaignManager] Step ${stepId} failed:`, err);
      await this.updateStepStatus(stepId, 'failed');
    }
  }

  /**
   * Pause a campaign. All pending/running steps stay in their current state.
   */
  async pause(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, id));
  }

  /**
   * Resume a paused campaign.
   */
  async resume(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, id));
  }

  /**
   * Complete a campaign with a hypothesis verdict.
   */
  async complete(id: string, verdict: HypothesisVerdict): Promise<void> {
    await db
      .update(campaigns)
      .set({
        status: 'completed',
        verdict: JSON.stringify(verdict),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(campaigns.id, id));
  }

  /**
   * Get aggregate metrics for a campaign.
   */
  async getMetrics(id: string): Promise<CampaignMetrics> {
    const rows = await db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, id));

    return {
      totalLeads: rows.length,
      qualified: rows.filter(r => r.status !== 'failed').length,
      contentGenerated: rows.length,
      sent: rows.filter(r => r.sentAt).length,
      opened: rows.filter(r => r.openedAt).length,
      replied: rows.filter(r => r.repliedAt).length,
      converted: rows.filter(r => r.convertedAt).length,
      bounced: rows.filter(r => r.bouncedAt).length,
    };
  }

  // ---- private helpers ----

  private deserializeCampaign(row: any, stepRows: any[]): Campaign {
    return {
      id: row.id,
      conversationId: row.conversationId,
      title: row.title,
      hypothesis: row.hypothesis,
      status: row.status,
      targetSegment: row.targetSegment,
      channels: typeof row.channels === 'string' ? JSON.parse(row.channels) : (row.channels ?? []),
      successMetrics: typeof row.successMetrics === 'string' ? JSON.parse(row.successMetrics) : (row.successMetrics ?? []),
      steps: stepRows
        .map(s => this.deserializeStep(s))
        .sort((a, b) => a.stepIndex - b.stepIndex),
      metrics: typeof row.metrics === 'string' ? JSON.parse(row.metrics) : (row.metrics ?? {}),
      verdict: row.verdict
        ? typeof row.verdict === 'string' ? JSON.parse(row.verdict) : row.verdict
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private deserializeStep(row: any): CampaignStep {
    return {
      id: row.id,
      campaignId: row.campaignId,
      stepIndex: row.stepIndex,
      skillId: row.skillId,
      skillInput: typeof row.skillInput === 'string' ? JSON.parse(row.skillInput) : (row.skillInput ?? {}),
      channel: row.channel,
      status: row.status,
      dependsOn: typeof row.dependsOn === 'string' ? JSON.parse(row.dependsOn) : (row.dependsOn ?? []),
      approvalRequired: row.approvalRequired === 1 || row.approvalRequired === true,
      resultSetId: row.resultSetId,
      scheduledAt: row.scheduledAt,
      completedAt: row.completedAt,
    };
  }
}
```

---

### `src/app/api/campaigns/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { CampaignManager } from '@/lib/campaign/manager';

const manager = new CampaignManager();

// GET /api/campaigns — list campaigns with optional status filter
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as any;

  const campaigns = await manager.list(status || undefined);

  // Add summary metrics to each campaign
  const result = campaigns.map(c => ({
    ...c,
    progress: {
      completedSteps: c.steps.filter(s => s.status === 'completed').length,
      totalSteps: c.steps.length,
    },
  }));

  return NextResponse.json(result);
}

// POST /api/campaigns — create a campaign with steps
export async function POST(req: NextRequest) {
  const body = await req.json();

  const campaign = await manager.create({
    conversationId: body.conversationId,
    title: body.title,
    hypothesis: body.hypothesis,
    targetSegment: body.targetSegment ?? null,
    channels: body.channels ?? [],
    successMetrics: body.successMetrics ?? [],
  });

  // Add steps if provided
  if (body.steps && Array.isArray(body.steps)) {
    for (let i = 0; i < body.steps.length; i++) {
      const stepDef = body.steps[i];
      await manager.addStep(campaign.id, {
        stepIndex: i,
        skillId: stepDef.skillId,
        skillInput: stepDef.skillInput ?? {},
        channel: stepDef.channel ?? null,
        dependsOn: stepDef.dependsOn ?? (i > 0 ? [] : []),
        approvalRequired: stepDef.approvalRequired ?? true,
      });
    }
  }

  // Re-fetch to include steps
  const full = await manager.get(campaign.id);
  return NextResponse.json(full, { status: 201 });
}
```

---

### `src/app/api/campaigns/[id]/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { CampaignManager } from '@/lib/campaign/manager';

const manager = new CampaignManager();

// GET /api/campaigns/:id — campaign details with steps + metrics
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const campaign = await manager.get(params.id);
  if (!campaign) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  }

  const metrics = await manager.getMetrics(params.id);
  return NextResponse.json({ ...campaign, metrics });
}

// PATCH /api/campaigns/:id — update campaign (pause/resume/complete)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json();

  try {
    if (body.action === 'pause') {
      await manager.pause(params.id);
    } else if (body.action === 'resume') {
      await manager.resume(params.id);
    } else if (body.action === 'complete') {
      await manager.complete(params.id, body.verdict);
    } else {
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
    }

    const updated = await manager.get(params.id);
    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

// DELETE /api/campaigns/:id — remove campaign
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  // Drizzle cascade will handle steps and content
  const { db } = await import('@/lib/db');
  const { campaigns } = await import('@/lib/db/schema');
  const { eq } = await import('drizzle-orm');

  await db.delete(campaigns).where(eq(campaigns.id, params.id));
  return NextResponse.json({ deleted: true });
}
```

---

### `src/app/api/campaigns/[id]/steps/[stepId]/execute/route.ts`

```ts
import { NextRequest, NextResponse } from 'next/server';
import { CampaignManager } from '@/lib/campaign/manager';

const manager = new CampaignManager();

// POST /api/campaigns/:id/steps/:stepId/execute — execute a specific step
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; stepId: string } }
) {
  try {
    // If this comes from an approval action, the step may need status update first
    const body = await req.json().catch(() => ({}));
    if (body.approved) {
      await manager.updateStepStatus(params.stepId, 'approved');
    }

    await manager.executeStep(params.id, params.stepId);

    const campaign = await manager.get(params.id);
    const step = campaign?.steps.find(s => s.id === params.stepId);

    return NextResponse.json({
      campaignId: params.id,
      stepId: params.stepId,
      status: step?.status ?? 'unknown',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
```

---

### `src/app/campaigns/page.tsx`

```tsx
import { JotaiProvider } from '@/components/providers/JotaiProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { CampaignsView } from '@/components/campaigns/CampaignsView';

export default function CampaignsPage() {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="campaigns" />
        <main className="flex-1 overflow-hidden">
          <CampaignsView />
        </main>
      </div>
    </JotaiProvider>
  );
}
```

---

### `src/app/campaigns/[id]/page.tsx`

```tsx
import { JotaiProvider } from '@/components/providers/JotaiProvider';
import { Sidebar } from '@/components/layout/Sidebar';
import { CampaignDetail } from '@/components/campaigns/CampaignDetail';

export default function CampaignDetailPage({ params }: { params: { id: string } }) {
  return (
    <JotaiProvider>
      <div className="flex h-screen">
        <Sidebar activeItem="campaigns" />
        <main className="flex-1 overflow-hidden">
          <CampaignDetail campaignId={params.id} />
        </main>
      </div>
    </JotaiProvider>
  );
}
```

---

### `src/components/campaigns/CampaignsView.tsx`

```tsx
'use client';

import { useEffect } from 'react';
import { useAtom } from 'jotai';
import { campaignsAtom, campaignsLoadingAtom, campaignFilterAtom } from '@/atoms/campaigns';
import type { CampaignStatus } from '@/lib/campaign/types';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const STATUS_TABS: { label: string; value: CampaignStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Paused', value: 'paused' },
  { label: 'Completed', value: 'completed' },
];

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  planning: 'bg-blueberry/20 text-blueberry',
  active: 'bg-matcha/20 text-matcha',
  paused: 'bg-tangerine/20 text-tangerine',
  completed: 'bg-muted text-muted-foreground',
  failed: 'bg-pomegranate/20 text-pomegranate',
};

export function CampaignsView() {
  const [campaigns, setCampaigns] = useAtom(campaignsAtom);
  const [loading, setLoading] = useAtom(campaignsLoadingAtom);
  const [filter, setFilter] = useAtom(campaignFilterAtom);

  useEffect(() => {
    async function fetchCampaigns() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (filter !== 'all') params.set('status', filter);
        const res = await fetch(`/api/campaigns?${params.toString()}`);
        const data = await res.json();
        setCampaigns(data);
      } finally {
        setLoading(false);
      }
    }
    fetchCampaigns();
  }, [filter, setCampaigns, setLoading]);

  return (
    <div className="flex flex-col h-full p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hypothesis-driven campaigns that compose skills into multi-step execution.
          </p>
        </div>
        <Link
          href="/"
          className="px-4 py-2 text-sm font-medium rounded-md bg-blueberry text-white hover:bg-blueberry/90"
        >
          New Campaign
        </Link>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              filter === tab.value
                ? 'bg-blueberry text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Campaign cards */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {loading ? (
          <div className="text-sm text-muted-foreground animate-pulse">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <p className="text-lg font-mono">No campaigns yet</p>
            <p className="text-sm mt-1">Start a chat and describe a multi-step outreach effort to create your first campaign.</p>
          </div>
        ) : (
          campaigns.map((campaign: any) => {
            const completedSteps = campaign.steps?.filter((s: any) => s.status === 'completed').length ?? 0;
            const totalSteps = campaign.steps?.length ?? 0;
            const progressPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

            return (
              <Link
                key={campaign.id}
                href={`/campaigns/${campaign.id}`}
                className="block border rounded-lg p-4 hover:border-blueberry/50 transition-colors bg-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-sm truncate">{campaign.title}</h3>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', STATUS_COLORS[campaign.status])}>
                        {campaign.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {campaign.hypothesis}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground whitespace-nowrap">
                    {campaign.channels?.join(', ')}
                  </div>
                </div>

                {/* Progress bar */}
                {totalSteps > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>{completedSteps}/{totalSteps} steps</span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-matcha rounded-full transition-all"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Key metrics */}
                {campaign.metrics && (campaign.metrics.sent > 0 || campaign.metrics.totalLeads > 0) && (
                  <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{campaign.metrics.totalLeads} leads</span>
                    <span>{campaign.metrics.sent} sent</span>
                    <span>{campaign.metrics.replied} replied</span>
                    <span>{campaign.metrics.converted} converted</span>
                  </div>
                )}
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
```

---

### `src/components/campaigns/CampaignDetail.tsx`

```tsx
'use client';

import { useEffect, useState } from 'react';
import { CampaignStepCard } from './CampaignStepCard';
import type { Campaign, CampaignMetrics, SuccessMetric } from '@/lib/campaign/types';
import { cn } from '@/lib/utils';

interface CampaignDetailProps {
  campaignId: string;
}

export function CampaignDetail({ campaignId }: CampaignDetailProps) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/campaigns/${campaignId}`);
        const data = await res.json();
        setCampaign(data);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [campaignId]);

  async function handleAction(action: 'pause' | 'resume') {
    await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    // Reload
    const res = await fetch(`/api/campaigns/${campaignId}`);
    setCampaign(await res.json());
  }

  async function handleExecuteStep(stepId: string) {
    await fetch(`/api/campaigns/${campaignId}/steps/${stepId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    // Reload
    const res = await fetch(`/api/campaigns/${campaignId}`);
    setCampaign(await res.json());
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground animate-pulse">Loading campaign...</div>;
  }

  if (!campaign) {
    return <div className="p-6 text-sm text-pomegranate">Campaign not found</div>;
  }

  const nextStep = campaign.steps.find(s => s.status === 'pending' || s.status === 'approved');

  return (
    <div className="flex flex-col h-full p-6 space-y-6 overflow-y-auto">
      {/* Hypothesis card */}
      <div className="border rounded-lg p-5 bg-card">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-xl font-bold font-mono">{campaign.title}</h1>
          <div className="flex items-center gap-2">
            {campaign.status === 'active' && (
              <button
                onClick={() => handleAction('pause')}
                className="px-3 py-1.5 text-sm rounded bg-tangerine text-white hover:bg-tangerine/90"
              >
                Pause
              </button>
            )}
            {campaign.status === 'paused' && (
              <button
                onClick={() => handleAction('resume')}
                className="px-3 py-1.5 text-sm rounded bg-matcha text-white hover:bg-matcha/90"
              >
                Resume
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground italic">Hypothesis: {campaign.hypothesis}</p>
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          {campaign.targetSegment && <span>Segment: {campaign.targetSegment}</span>}
          {campaign.channels.length > 0 && <span>Channels: {campaign.channels.join(', ')}</span>}
        </div>
      </div>

      {/* Success metrics */}
      {campaign.successMetrics.length > 0 && (
        <div className="border rounded-lg p-4 bg-card">
          <h2 className="text-sm font-medium font-mono mb-3">Success Metrics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campaign.successMetrics.map((m: SuccessMetric, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/50">
                <span className="text-sm">{m.metric}</span>
                <div className="text-right">
                  <span className="text-sm font-mono">
                    {m.actual ?? '---'} / {m.target}
                  </span>
                  {m.baseline !== null && (
                    <span className="text-xs text-muted-foreground ml-2">(baseline: {m.baseline})</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Steps timeline */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium font-mono">Steps</h2>
          {nextStep && (
            <button
              onClick={() => handleExecuteStep(nextStep.id)}
              className="px-3 py-1.5 text-sm font-medium rounded bg-blueberry text-white hover:bg-blueberry/90"
            >
              Execute Next Step
            </button>
          )}
        </div>
        <div className="space-y-0">
          {campaign.steps.map((step, i) => (
            <CampaignStepCard
              key={step.id}
              step={step}
              isLast={i === campaign.steps.length - 1}
              onExecute={() => handleExecuteStep(step.id)}
            />
          ))}
        </div>
      </div>

      {/* Verdict (if completed) */}
      {campaign.verdict && (
        <div className={cn(
          'border rounded-lg p-4',
          campaign.verdict.result === 'confirmed' && 'border-matcha bg-matcha/5',
          campaign.verdict.result === 'disproven' && 'border-pomegranate bg-pomegranate/5',
          campaign.verdict.result === 'inconclusive' && 'border-tangerine bg-tangerine/5',
        )}>
          <h2 className="text-sm font-medium font-mono mb-1">
            Verdict: {campaign.verdict.result.toUpperCase()}
          </h2>
          <p className="text-sm text-muted-foreground">{campaign.verdict.evidence}</p>
        </div>
      )}
    </div>
  );
}
```

---

### `src/components/campaigns/CampaignStepCard.tsx`

```tsx
'use client';

import { useState } from 'react';
import type { CampaignStep } from '@/lib/campaign/types';
import { cn } from '@/lib/utils';
import Link from 'next/link';

const STATUS_ICON: Record<string, { color: string; label: string }> = {
  pending: { color: 'bg-muted', label: 'Pending' },
  waiting_approval: { color: 'bg-tangerine animate-pulse', label: 'Needs Review' },
  approved: { color: 'bg-blueberry', label: 'Approved' },
  running: { color: 'bg-blueberry animate-pulse', label: 'Running' },
  completed: { color: 'bg-matcha', label: 'Completed' },
  failed: { color: 'bg-pomegranate', label: 'Failed' },
  skipped: { color: 'bg-muted', label: 'Skipped' },
};

interface CampaignStepCardProps {
  step: CampaignStep;
  isLast: boolean;
  onExecute: () => void;
}

export function CampaignStepCard({ step, isLast, onExecute }: CampaignStepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = STATUS_ICON[step.status] ?? STATUS_ICON.pending;

  return (
    <div className="flex gap-3">
      {/* Timeline connector */}
      <div className="flex flex-col items-center">
        <div className={cn('w-3 h-3 rounded-full mt-1.5 shrink-0', statusInfo.color)} />
        {!isLast && <div className="w-px flex-1 bg-border mt-1" />}
      </div>

      {/* Card */}
      <div className="flex-1 pb-4">
        <div
          className="border rounded-lg p-3 bg-card cursor-pointer hover:border-blueberry/30 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Step {step.stepIndex + 1}</span>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-muted">{step.skillId}</span>
              {step.channel && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-blueberry/10 text-blueberry">{step.channel}</span>
              )}
            </div>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              step.status === 'completed' && 'bg-matcha/20 text-matcha',
              step.status === 'failed' && 'bg-pomegranate/20 text-pomegranate',
              step.status === 'running' && 'bg-blueberry/20 text-blueberry',
              step.status === 'waiting_approval' && 'bg-tangerine/20 text-tangerine',
              (step.status === 'pending' || step.status === 'approved' || step.status === 'skipped') && 'bg-muted text-muted-foreground',
            )}>
              {statusInfo.label}
            </span>
          </div>

          {/* Waiting approval link */}
          {step.status === 'waiting_approval' && (
            <Link
              href="/reviews"
              className="inline-block mt-2 text-xs text-tangerine hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              View in Reviews queue
            </Link>
          )}

          {/* Expanded details */}
          {expanded && (
            <div className="mt-3 pt-3 border-t space-y-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium">Config:</span>
                <pre className="mt-1 p-2 rounded bg-muted overflow-x-auto text-[11px]">
                  {JSON.stringify(step.skillInput, null, 2)}
                </pre>
              </div>
              {step.resultSetId && (
                <div>
                  <span className="font-medium">Result Set:</span>{' '}
                  <span className="font-mono">{step.resultSetId}</span>
                </div>
              )}
              {step.approvalRequired && (
                <div className="text-tangerine">Approval required before execution</div>
              )}
              {step.completedAt && (
                <div>Completed: {new Date(step.completedAt).toLocaleString()}</div>
              )}
              {step.status === 'pending' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onExecute(); }}
                  className="px-3 py-1 text-xs rounded bg-blueberry text-white hover:bg-blueberry/90"
                >
                  Execute Step
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### `src/components/campaigns/CampaignPreviewCard.tsx`

Shown in chat when Claude proposes a campaign.

```tsx
'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface CampaignProposal {
  title: string;
  hypothesis: string;
  targetSegment: string;
  channels: string[];
  successMetrics: { metric: string; target: number }[];
  steps: { skillId: string; channel?: string; approvalRequired?: boolean }[];
}

interface CampaignPreviewCardProps {
  proposal: CampaignProposal;
  conversationId: string;
  onCreated?: (campaignId: string) => void;
}

export function CampaignPreviewCard({ proposal, conversationId, onCreated }: CampaignPreviewCardProps) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [campaignId, setCampaignId] = useState<string | null>(null);

  async function handleStart() {
    setCreating(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          title: proposal.title,
          hypothesis: proposal.hypothesis,
          targetSegment: proposal.targetSegment,
          channels: proposal.channels,
          successMetrics: proposal.successMetrics.map(m => ({
            ...m,
            baseline: null,
            actual: null,
          })),
          steps: proposal.steps.map((s, i) => ({
            skillId: s.skillId,
            skillInput: {},
            channel: s.channel ?? null,
            approvalRequired: s.approvalRequired ?? true,
          })),
        }),
      });
      const campaign = await res.json();
      setCampaignId(campaign.id);
      setCreated(true);
      onCreated?.(campaign.id);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="border rounded-lg p-4 bg-card my-2">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium uppercase tracking-wider text-blueberry">Campaign Proposal</span>
      </div>
      <h3 className="font-medium text-sm">{proposal.title}</h3>
      <p className="text-xs text-muted-foreground mt-1 italic">{proposal.hypothesis}</p>

      {/* Metadata */}
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span>Segment: {proposal.targetSegment}</span>
        <span>Channels: {proposal.channels.join(', ')}</span>
      </div>

      {/* Success metrics */}
      <div className="mt-3 space-y-1">
        <p className="text-xs font-medium">Success Metrics:</p>
        {proposal.successMetrics.map((m, i) => (
          <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{m.metric}</span>
            <span className="font-mono">target: {m.target}</span>
          </div>
        ))}
      </div>

      {/* Steps */}
      <div className="mt-3 space-y-1">
        <p className="text-xs font-medium">Steps:</p>
        {proposal.steps.map((s, i) => (
          <div key={i} className="text-xs text-muted-foreground flex items-center gap-2">
            <span className="w-4 text-right font-mono">{i + 1}.</span>
            <span className="font-mono">{s.skillId}</span>
            {s.channel && <span className="text-blueberry">[{s.channel}]</span>}
            {s.approvalRequired !== false && <span className="text-tangerine">(approval)</span>}
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="mt-4">
        {created ? (
          <a
            href={`/campaigns/${campaignId}`}
            className="inline-block px-4 py-2 text-sm font-medium rounded bg-matcha text-white hover:bg-matcha/90"
          >
            View Campaign
          </a>
        ) : (
          <button
            onClick={handleStart}
            disabled={creating}
            className="px-4 py-2 text-sm font-medium rounded bg-blueberry text-white hover:bg-blueberry/90 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Start Campaign'}
          </button>
        )}
      </div>
    </div>
  );
}
```

---

### `src/atoms/campaigns.ts`

```ts
import { atom } from 'jotai';
import type { Campaign, CampaignStatus } from '@/lib/campaign/types';

export const campaignsAtom = atom<Campaign[]>([]);
export const activeCampaignAtom = atom<Campaign | null>(null);
export const campaignsLoadingAtom = atom(false);
export const campaignFilterAtom = atom<CampaignStatus | 'all'>('all');
```

---

## Existing Files to Modify

### `src/lib/db/schema.ts`

**Add** the `campaigns` table:

```ts
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  hypothesis: text('hypothesis').notNull(),
  status: text('status').notNull().default('draft'),
  targetSegment: text('target_segment'),
  channels: text('channels').notNull(),                // JSON: string[]
  successMetrics: text('success_metrics').notNull(),    // JSON: SuccessMetric[]
  metrics: text('metrics').notNull(),                   // JSON: CampaignMetrics
  verdict: text('verdict'),                             // JSON: HypothesisVerdict | null
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});
```

**Add** the `campaign_steps` table:

```ts
export const campaignSteps = sqliteTable('campaign_steps', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  skillId: text('skill_id').notNull(),
  skillInput: text('skill_input').notNull(),            // JSON: Record<string, unknown>
  channel: text('channel'),
  status: text('status').notNull().default('pending'),
  dependsOn: text('depends_on').notNull().default('[]'), // JSON: string[]
  approvalRequired: integer('approval_required').notNull().default(1),
  resultSetId: text('result_set_id'),
  scheduledAt: text('scheduled_at'),
  completedAt: text('completed_at'),
});
```

**Add** the `campaign_content` table:

```ts
export const campaignContent = sqliteTable('campaign_content', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull().references(() => campaignSteps.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  targetLeadId: text('target_lead_id'),
  content: text('content').notNull(),
  variant: text('variant'),
  status: text('status').notNull().default('draft'),
  personalizationData: text('personalization_data').notNull(), // JSON
  sentAt: text('sent_at'),
  openedAt: text('opened_at'),
  clickedAt: text('clicked_at'),
  repliedAt: text('replied_at'),
  convertedAt: text('converted_at'),
  bouncedAt: text('bounced_at'),
});
```

**Add** relations for all three:

```ts
export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [campaigns.conversationId],
    references: [conversations.id],
  }),
  steps: many(campaignSteps),
  content: many(campaignContent),
}));

export const campaignStepsRelations = relations(campaignSteps, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignSteps.campaignId],
    references: [campaigns.id],
  }),
}));

export const campaignContentRelations = relations(campaignContent, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignContent.campaignId],
    references: [campaigns.id],
  }),
  step: one(campaignSteps, {
    fields: [campaignContent.stepId],
    references: [campaignSteps.id],
  }),
}));
```

---

### `src/components/layout/Sidebar.tsx`

**Add** a "Campaigns" nav item. Place it between "Chat" and "Tables" (or wherever the chat entry is).

1. Find the nav items array/config.

2. Add this entry at the correct position:
   ```ts
   {
     id: 'campaigns',
     label: 'Campaigns',
     href: '/campaigns',
     icon: /* rocket SVG, 16x16, drawn as a simple rocket */,
     accent: 'dragonfruit',
     comingSoon: false,
   }
   ```

3. The rocket icon SVG (16x16):
   ```tsx
   <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
     <path d="M8 1L10.5 6.5L14 8L10.5 9.5L8 15L5.5 9.5L2 8L5.5 6.5L8 1Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
   </svg>
   ```

   **Note:** If the design system uses a different icon set or convention (check existing Sidebar icons), match that style. The above is a fallback. A simple upward arrow or diamond works too.

---

### `src/lib/ai/workflow-planner.ts`

**Change:** Extend the planner to propose campaigns alongside workflows.

1. Add a new tool definition to the existing tools array (alongside `propose_workflow`):
   ```ts
   {
     name: 'propose_campaign',
     description: 'Propose a hypothesis-driven campaign when the user describes a multi-step, multi-channel outreach effort. Use this instead of propose_workflow when the request involves testing a hypothesis, reaching a specific segment across channels, or measuring success metrics.',
     input_schema: {
       type: 'object',
       properties: {
         title: { type: 'string', description: 'Short campaign title' },
         hypothesis: { type: 'string', description: 'The thesis being tested' },
         targetSegment: { type: 'string', description: 'ICP segment to target' },
         channels: {
           type: 'array',
           items: { type: 'string' },
           description: 'Channels to use (email, linkedin, etc.)',
         },
         successMetrics: {
           type: 'array',
           items: {
             type: 'object',
             properties: {
               metric: { type: 'string' },
               target: { type: 'number' },
             },
             required: ['metric', 'target'],
           },
         },
         steps: {
           type: 'array',
           items: {
             type: 'object',
             properties: {
               skillId: { type: 'string' },
               channel: { type: 'string' },
               approvalRequired: { type: 'boolean' },
             },
             required: ['skillId'],
           },
         },
       },
       required: ['title', 'hypothesis', 'targetSegment', 'channels', 'successMetrics', 'steps'],
     },
   }
   ```

2. Update the system prompt to include guidance on when to use `propose_campaign` vs `propose_workflow`:
   ```
   When the user describes a multi-step, multi-channel outreach effort with a clear hypothesis or goal,
   use the propose_campaign tool. When they describe a simpler data operation (find, enrich, qualify),
   use propose_workflow. Campaign proposals should always include a testable hypothesis and success metrics.
   ```

---

### `src/components/chat/ChatPanel.tsx`

**Change:** Handle `propose_campaign` tool results.

1. Import `CampaignPreviewCard`:
   ```ts
   import { CampaignPreviewCard } from '@/components/campaigns/CampaignPreviewCard';
   ```

2. In the section where tool results are rendered (look for where `propose_workflow` is handled), add a parallel case:
   ```tsx
   if (toolName === 'propose_campaign') {
     return (
       <CampaignPreviewCard
         proposal={toolResult}
         conversationId={conversationId}
         onCreated={(id) => {
           // Optionally navigate or show success message
         }}
       />
     );
   }
   ```

---

### `src/components/chat/MessageBubble.tsx`

**Change:** Add rendering for campaign proposals in the message bubble.

Find where tool use results are rendered (likely near the `propose_workflow` rendering). Add a similar block:

```tsx
if (block.type === 'tool_use' && block.name === 'propose_campaign') {
  return (
    <CampaignPreviewCard
      key={block.id}
      proposal={block.input as any}
      conversationId={conversationId}
    />
  );
}
```

Import `CampaignPreviewCard` at the top of the file.

---

## Verification Steps

Run these checks in order. Every one must pass before committing.

1. **Chat-driven creation:** Open the app -> start a chat -> type: "Run an outreach campaign targeting French SaaS CTOs via email and LinkedIn". Claude proposes a campaign with hypothesis, steps, metrics.
2. **Campaign creation:** Click "Start Campaign" on the proposal card. Campaign is created and visible at `/campaigns`.
3. **Campaign detail:** Navigate to `/campaigns/[id]`. Shows hypothesis card, success metrics, steps timeline.
4. **Step execution:** Click "Execute Next Step". The first step (e.g. find-companies) runs the skill and creates a resultSet.
5. **Approval gate:** A step with `approvalRequired: true` should create a review request in `/reviews`. The step shows "Needs Review" status.
6. **Pause/Resume:** Click Pause on an active campaign. Status changes. Click Resume. Status changes back.
7. **Sidebar:** "Campaigns" nav item appears with the correct icon.
8. **`pnpm build`** — production build completes with zero errors and zero TypeScript errors.

---

## Commit Message

```
feat: campaign manager with hypothesis-driven campaigns (4.8)
```
