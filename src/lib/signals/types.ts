// SignalType — what interaction generated this signal
export type SignalType =
  | 'rlhf_feedback'
  | 'workflow_edit'
  | 'export_selection'
  | 'chat_correction'
  | 'search_refinement'
  | 'rerun'
  | 'campaign_outcome'
  | 'provider_performance'
  | 'human_review_decision'
  | 'ab_test_result'

// Signal — a single data point emitted by user interactions
export interface Signal {
  id: string
  type: SignalType
  category: string // maps to IntelligenceCategory
  data: Record<string, unknown>
  conversationId?: string
  resultSetId?: string
  campaignId?: string
  createdAt: string
}
