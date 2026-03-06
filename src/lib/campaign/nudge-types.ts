export type NudgeCategory =
  | 'audience'
  | 'content'
  | 'timing'
  | 'channel'
  | 'volume'
  | 'icp'
  | 'ab_verdict'
  | 'campaign_health'

export interface NudgeEvidence {
  metric: string
  current: number
  comparison: number
  source: string
}

export interface NudgeImpact {
  metric: string
  currentValue: number
  projectedValue: number
  confidence: number
}

export interface NudgeAction {
  endpoint: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body: unknown
}

export interface Nudge {
  category: NudgeCategory
  insight: string
  recommendation: string
  evidence: NudgeEvidence[]
  impact: NudgeImpact
  action: NudgeAction
  alternatives: {
    title: string
    action: NudgeAction
  }[]
  showDataEndpoint: string
}

export interface AbTestVerdict {
  variantA: string
  variantB: string
  winner: string | null
  metric: string
  aValue: number
  bValue: number
  sampleSizeA: number
  sampleSizeB: number
  significant: boolean
}
