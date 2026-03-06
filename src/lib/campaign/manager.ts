import { randomUUID } from 'crypto'
import { eq, desc } from 'drizzle-orm'
import { db } from '../db'
import { campaigns, campaignSteps, campaignContent } from '../db/schema'
import { ReviewQueue } from '../review/queue'
import { getCollector } from '../signals/collector'
import type {
  Campaign,
  CampaignStatus,
  CampaignStep,
  CampaignMetrics,
  HypothesisVerdict,
  StepStatus,
  SuccessMetric,
} from './types'

interface CreateParams {
  conversationId: string
  title: string
  hypothesis: string
  targetSegment: string | null
  channels: string[]
  successMetrics: SuccessMetric[]
}

interface AddStepParams {
  stepIndex: number
  skillId: string
  skillInput: Record<string, unknown>
  channel?: string | null
  dependsOn?: string[]
  approvalRequired?: boolean
}

const reviewQueue = new ReviewQueue()

export class CampaignManager {
  async create(params: CreateParams): Promise<Campaign> {
    const id = randomUUID()
    const now = new Date().toISOString()

    const emptyMetrics: CampaignMetrics = {
      totalLeads: 0, qualified: 0, contentGenerated: 0,
      sent: 0, opened: 0, replied: 0, converted: 0, bounced: 0,
    }

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
    })

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
    }
  }

  async get(id: string): Promise<Campaign | null> {
    const rows = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1)

    if (rows.length === 0) return null

    const steps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, id))

    return this.deserializeCampaign(rows[0], steps)
  }

  async list(status?: CampaignStatus): Promise<Campaign[]> {
    const query = status
      ? db.select().from(campaigns).where(eq(campaigns.status, status))
      : db.select().from(campaigns)

    const rows = await query.orderBy(desc(campaigns.updatedAt))

    const result: Campaign[] = []
    for (const row of rows) {
      const steps = await db
        .select()
        .from(campaignSteps)
        .where(eq(campaignSteps.campaignId, row.id))
      result.push(this.deserializeCampaign(row, steps))
    }

    return result
  }

  async addStep(campaignId: string, step: AddStepParams): Promise<CampaignStep> {
    const id = randomUUID()

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
    }

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
    })

    await db
      .update(campaigns)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, campaignId))

    return entry
  }

  async updateStepStatus(stepId: string, status: StepStatus): Promise<void> {
    const updates: Record<string, unknown> = { status }
    if (status === 'completed' || status === 'failed' || status === 'skipped') {
      updates.completedAt = new Date().toISOString()
    }

    await db
      .update(campaignSteps)
      .set(updates)
      .where(eq(campaignSteps.id, stepId))
  }

  async executeStep(campaignId: string, stepId: string): Promise<void> {
    const campaign = await this.get(campaignId)
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

    const step = campaign.steps.find(s => s.id === stepId)
    if (!step) throw new Error(`Step ${stepId} not found in campaign ${campaignId}`)

    // Check dependencies
    for (const depId of step.dependsOn) {
      const depStep = campaign.steps.find(s => s.id === depId)
      if (depStep && depStep.status !== 'completed') {
        throw new Error(`Dependency step ${depId} has not completed (status: ${depStep.status})`)
      }
    }

    // If approval is required and step hasn't been approved yet, create a review request
    if (step.approvalRequired && step.status === 'pending') {
      await this.updateStepStatus(stepId, 'waiting_approval')

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
      })

      return
    }

    // Run the skill
    await this.updateStepStatus(stepId, 'running')

    try {
      const { getSkillRegistry } = await import('../skills/registry')
      const skillRegistry = getSkillRegistry()
      const skill = skillRegistry.get(step.skillId)

      if (!skill) {
        throw new Error(`Skill "${step.skillId}" not found in registry`)
      }

      // Build a minimal skill context
      const { getRegistry } = await import('../providers/registry')
      const context = {
        framework: {} as import('../framework/types').GTMFramework,
        intelligence: [],
        providers: getRegistry(),
        userId: 'campaign-manager',
      }

      // Consume the async iterable from the skill
      let resultSetId: string | null = null
      for await (const event of skill.execute(step.skillInput, context)) {
        if (event.type === 'result') {
          const data = event.data as Record<string, unknown>
          if (data.resultSetId) {
            resultSetId = data.resultSetId as string
          }
        }
      }

      if (resultSetId) {
        await db
          .update(campaignSteps)
          .set({ resultSetId })
          .where(eq(campaignSteps.id, stepId))
      }

      await this.updateStepStatus(stepId, 'completed')

      // Emit campaign outcome signal
      await getCollector().emit({
        type: 'campaign_outcome',
        category: 'campaign',
        data: { campaignId, stepId, skillId: step.skillId, resultSetId },
        campaignId,
      })

      if (campaign.status === 'draft' || campaign.status === 'planning') {
        await db
          .update(campaigns)
          .set({ status: 'active', updatedAt: new Date().toISOString() })
          .where(eq(campaigns.id, campaignId))
      }
    } catch (err) {
      console.error(`[CampaignManager] Step ${stepId} failed:`, err)
      await this.updateStepStatus(stepId, 'failed')
    }
  }

  async pause(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, id))
  }

  async resume(id: string): Promise<void> {
    await db
      .update(campaigns)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(campaigns.id, id))
  }

  async complete(id: string, verdict: HypothesisVerdict): Promise<void> {
    await db
      .update(campaigns)
      .set({
        status: 'completed',
        verdict: JSON.stringify(verdict),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(campaigns.id, id))
  }

  async getMetrics(id: string): Promise<CampaignMetrics> {
    const rows = await db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, id))

    return {
      totalLeads: rows.length,
      qualified: rows.filter(r => r.status !== 'failed').length,
      contentGenerated: rows.length,
      sent: rows.filter(r => r.sentAt).length,
      opened: rows.filter(r => r.openedAt).length,
      replied: rows.filter(r => r.repliedAt).length,
      converted: rows.filter(r => r.convertedAt).length,
      bounced: rows.filter(r => r.bouncedAt).length,
    }
  }

  async getMetricsBreakdown(id: string): Promise<{
    byStep: Record<string, CampaignMetrics>
    byChannel: Record<string, CampaignMetrics>
    byVariant: Record<string, CampaignMetrics>
  }> {
    const rows = await db
      .select()
      .from(campaignContent)
      .where(eq(campaignContent.campaignId, id))

    const steps = await db
      .select()
      .from(campaignSteps)
      .where(eq(campaignSteps.campaignId, id))

    const emptyMetrics = (): CampaignMetrics => ({
      totalLeads: 0, qualified: 0, contentGenerated: 0,
      sent: 0, opened: 0, replied: 0, converted: 0, bounced: 0,
    })

    const byStep: Record<string, CampaignMetrics> = {}
    const byChannel: Record<string, CampaignMetrics> = {}
    const byVariant: Record<string, CampaignMetrics> = {}

    for (const row of rows) {
      // By step
      const step = steps.find(s => s.id === row.stepId)
      const stepKey = step ? `step_${step.stepIndex}` : 'unknown'
      if (!byStep[stepKey]) byStep[stepKey] = emptyMetrics()
      this.accumulateMetrics(byStep[stepKey], row)

      // By channel (from step)
      const channel = step?.channel ?? 'unknown'
      if (!byChannel[channel]) byChannel[channel] = emptyMetrics()
      this.accumulateMetrics(byChannel[channel], row)

      // By variant
      const variant = row.variant ?? 'default'
      if (!byVariant[variant]) byVariant[variant] = emptyMetrics()
      this.accumulateMetrics(byVariant[variant], row)
    }

    return { byStep, byChannel, byVariant }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private accumulateMetrics(metrics: CampaignMetrics, row: any): void {
    metrics.totalLeads++
    metrics.contentGenerated++
    if (row.status !== 'failed') metrics.qualified++
    if (row.sentAt) metrics.sent++
    if (row.openedAt) metrics.opened++
    if (row.repliedAt) metrics.replied++
    if (row.convertedAt) metrics.converted++
    if (row.bouncedAt) metrics.bounced++
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    }
  }
}
