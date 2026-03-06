# Sub-Brief 4.11 — Campaign Optimization (Nudge Engine)

**What you're building:** An analysis engine that reviews campaign performance and generates specific, evidence-backed, actionable nudges. Each nudge tells the human: what's happening, why it matters, what to do, and offers a one-click action.

**Read these files first:**
1. `src/lib/campaign/types.ts` — Campaign, CampaignMetrics (from 4.8)
2. `src/lib/campaign/manager.ts` — CampaignManager (from 4.8)
3. `src/lib/intelligence/store.ts` — IntelligenceStore (from 4.5)
4. `src/lib/review/queue.ts` — ReviewQueue (from 4.6)
5. `src/lib/review/types.ts` — NudgeEvidence (from 4.6)
6. `src/lib/ai/client.ts` — Anthropic client
7. `docs/SYSTEMS_ARCHITECTURE.md` — Campaign Optimization section

---

## New files

### `src/lib/campaign/optimizer.ts`

**CampaignOptimizer** class:

- `analyze(campaignId: string): Promise<Nudge[]>`
  1. Load campaign + steps + content metrics
  2. Load relevant intelligence (segment, channels)
  3. Load historical campaign data for benchmarks
  4. Call Claude (Sonnet) with structured prompt:
     - Current metrics vs targets vs benchmarks
     - Content variant performance (A/B)
     - Channel performance comparison
     - Segment performance breakdown
  5. Tool definition:
     ```
     generate_nudges → Nudge[]
     ```
  6. Each nudge must be specific (not generic), evidence-backed, and include a one-click action

- `analyzeAllActive(): Promise<{ campaignId: string, nudges: Nudge[] }[]>`
  - Runs `analyze()` on all active campaigns

- `checkAbTestVerdicts(campaignId: string): Promise<AbTestVerdict[]>`
  - For each content variant pair: calculate if winner can be declared
  - Statistical significance approximation: if difference > 2x and `sampleSize` > 50 per variant → significant

---

### `src/lib/campaign/nudge-types.ts`

```ts
NudgeCategory: 'audience' | 'content' | 'timing' | 'channel' | 'volume' | 'icp' | 'ab_verdict' | 'campaign_health'

Nudge interface:
  category: NudgeCategory
  insight: string                   // what the OS noticed
  recommendation: string            // what the OS suggests
  evidence: {
    metric: string
    current: number
    comparison: number
    source: string
  }[]
  impact: {
    metric: string
    currentValue: number
    projectedValue: number
    confidence: number
  }
  action: {                         // one-click apply
    endpoint: string
    method: string
    body: unknown
  }
  alternatives: {
    title: string
    action: {
      endpoint: string
      method: string
      body: unknown
    }
  }[]
  showDataEndpoint: string          // link to see underlying data

AbTestVerdict interface:
  variantA: string
  variantB: string
  winner: string | null
  metric: string
  aValue: number
  bValue: number
  sampleSizeA: number
  sampleSizeB: number
  significant: boolean
```

---

### `src/app/api/campaigns/[id]/analyze/route.ts`

- **POST**: trigger analysis for a campaign
- Returns: `{ nudges: Nudge[], abVerdicts: AbTestVerdict[] }`
- Creates `ReviewRequest` entries for each nudge (type=`'nudge'`, priority=`'normal'`)

---

### `src/app/api/campaigns/analyze-all/route.ts`

- **POST**: analyze all active campaigns
- Returns summary: `{ analyzed: number, nudgesGenerated: number }`
- Creates `ReviewRequest` entries for each nudge

---

## Existing files to modify

### `src/lib/campaign/manager.ts`

Add method:

```ts
getMetricsBreakdown(campaignId: string): Promise<{
  byStep: Record<string, CampaignMetrics>
  byChannel: Record<string, CampaignMetrics>
  byVariant: Record<string, CampaignMetrics>
}>
```

This gives the optimizer the detailed data it needs for comparison and analysis.

---

### `src/components/campaigns/CampaignDetail.tsx`

- Add "Analyze Campaign" button (blueberry color)
- Shows loading state while analyzing
- When complete: shows nudge count badge, links to `/reviews` filtered for this campaign

---

## Verify

1. Create a campaign, execute a few steps (even with mock data)
2. `POST /api/campaigns/[id]/analyze` → returns nudges
3. Nudges are specific: "Mock provider accuracy is 100% since all data is generated. Connect a real provider for meaningful optimization."
4. Each nudge has an `action` endpoint
5. Nudges appear in `/reviews` as nudge type
6. `pnpm build` clean

---

**Commit:** `feat: campaign optimization nudge engine (4.11)`
