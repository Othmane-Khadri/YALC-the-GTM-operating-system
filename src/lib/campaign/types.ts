export type CampaignStatus = 'draft' | 'planning' | 'active' | 'paused' | 'completed' | 'failed'

export type StepStatus =
  | 'pending'
  | 'waiting_approval'
  | 'approved'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type ContentStatus = 'draft' | 'pending_review' | 'approved' | 'scheduled' | 'sent' | 'failed'

export interface SuccessMetric {
  metric: string
  target: number
  baseline: number | null
  actual: number | null
}

export interface HypothesisVerdict {
  result: 'confirmed' | 'disproven' | 'inconclusive'
  evidence: string
  newIntelligence?: unknown[]
}

export interface Campaign {
  id: string
  conversationId: string
  title: string
  hypothesis: string
  status: CampaignStatus
  targetSegment: string | null
  channels: string[]
  successMetrics: SuccessMetric[]
  steps: CampaignStep[]
  metrics: CampaignMetrics
  verdict: HypothesisVerdict | null
  createdAt: string
  updatedAt: string
}

export interface CampaignStep {
  id: string
  campaignId: string
  stepIndex: number
  skillId: string
  skillInput: Record<string, unknown>
  channel: string | null
  status: StepStatus
  dependsOn: string[]
  approvalRequired: boolean
  resultSetId: string | null
  scheduledAt: string | null
  completedAt: string | null
}

export interface CampaignContent {
  id: string
  campaignId: string
  stepId: string
  contentType: string
  targetLeadId: string | null
  content: string
  variant: string | null
  status: ContentStatus
  personalizationData: Record<string, unknown>
  metrics: ContentMetrics
}

export interface ContentMetrics {
  sentAt: string | null
  openedAt: string | null
  clickedAt: string | null
  repliedAt: string | null
  convertedAt: string | null
  bouncedAt: string | null
}

export interface CampaignMetrics {
  totalLeads: number
  qualified: number
  contentGenerated: number
  sent: number
  opened: number
  replied: number
  converted: number
  bounced: number
}
