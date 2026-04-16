// IntelligenceCategory — the domain this intelligence applies to
export type IntelligenceCategory =
  | 'icp'
  | 'channel'
  | 'content'
  | 'timing'
  | 'provider'
  | 'qualification'
  | 'campaign'
  | 'competitive'

// IntelligenceSource — how this intelligence was produced
export type IntelligenceSource =
  | 'rlhf'
  | 'campaign_outcome'
  | 'ab_test'
  | 'implicit'
  | 'external'
  | 'human_input'
  | 'correction'

// ConfidenceLevel — lifecycle stage of an intelligence entry
export type ConfidenceLevel = 'hypothesis' | 'validated' | 'proven'

// Evidence — a single supporting data point
export interface Evidence {
  type: string
  sourceId: string
  metric: string
  value: number
  sampleSize: number
  timestamp: string
}

// BiasCheck — validation that the intelligence isn't skewed
export interface BiasCheck {
  sampleSize: number
  segmentBalance: boolean
  timeSpan: number
  recencyWeighted: boolean
  checkedAt: string
}

// Intelligence — the core entity
export interface Intelligence {
  id: string
  category: IntelligenceCategory
  insight: string
  evidence: Evidence[]
  segment: string | null
  channel: string | null
  confidence: ConfidenceLevel
  confidenceScore: number
  source: IntelligenceSource
  biasCheck: BiasCheck | null
  supersedes: string | null
  createdAt: string
  validatedAt: string | null
  expiresAt: string | null
}
