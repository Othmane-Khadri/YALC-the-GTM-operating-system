export type ReviewType =
  | 'content_review'
  | 'campaign_gate'
  | 'nudge'
  | 'intelligence'
  | 'intelligence_confirmation'
  | 'data_quality'
  | 'anomaly'
  | 'escalation'
  | 'snapshot_request'
  | 'lead_qualification'

export type ReviewPriority = 'low' | 'normal' | 'high' | 'urgent'

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'dismissed' | 'expired'

export interface ReviewAction {
  endpoint: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body: unknown
}

export interface NudgeEvidence {
  metrics: { name: string; current: number; projected: number }[]
  reasoning: string
  alternatives: {
    title: string
    action: ReviewAction
  }[]
  showDataEndpoint: string | null
}

export interface ReviewRequest {
  id: string
  type: ReviewType
  title: string
  description: string
  sourceSystem: string
  sourceId: string
  priority: ReviewPriority
  status: ReviewStatus
  payload: Record<string, unknown>
  action: ReviewAction | null
  nudgeEvidence: NudgeEvidence | null
  reviewedAt: string | null
  reviewNotes: string | null
  expiresAt: string | null
  createdAt: string
}
