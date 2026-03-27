// ─── Campaign Intelligence Report Types ──────────────────────────────────────

export interface FunnelStage {
  stage: string
  count: number
  dropoffRate: number // percentage drop from previous stage
}

export interface FunnelSection {
  stages: FunnelStage[]
  totalLeads: number
  overallConversionRate: number
}

export interface VariantStats {
  name: string
  variantId: string
  sends: number
  accepts: number
  acceptRate: number
  dmsSent: number
  replies: number
  replyRate: number
  leadsAssigned: number
  avgTimeToAcceptHours: number | null
  avgTimeToReplyHours: number | null
}

export interface VariantSection {
  variants: VariantStats[]
}

export interface TagStats {
  tag: string
  count: number
  acceptRate: number
  replyRate: number
}

export interface TagSection {
  tags: TagStats[]
}

export interface SourceStats {
  source: string
  count: number
  acceptRate: number
  replyRate: number
}

export interface SourceSection {
  sources: SourceStats[]
}

export interface SegmentStats {
  segment: string
  count: number
  acceptRate: number
  replyRate: number
}

export interface SegmentSection {
  segments: SegmentStats[]
}

export interface ScoreRangeBucket {
  range: string
  min: number
  max: number
  count: number
  acceptRate: number
  replyRate: number
}

export interface ScoringAccuracySection {
  buckets: ScoreRangeBucket[]
  pearsonCorrelation: number | null
}

export interface WeekStats {
  weekStart: string
  sends: number
  accepts: number
  acceptRate: number
  replies: number
  replyRate: number
}

export interface TrendsSection {
  weeks: WeekStats[]
}

export interface WinnerDeclaration {
  variantName: string
  margin: number
  isStatisticallySignificant: boolean
  bestReplyRate: number
  runnerUpReplyRate: number
}

export interface CampaignReport {
  campaignId: string
  campaignTitle: string
  generatedAt: string
  funnel: FunnelSection
  variants: VariantSection
  tags: TagSection
  sources: SourceSection
  segments: SegmentSection
  scoringAccuracy: ScoringAccuracySection
  trends: TrendsSection
  winner: WinnerDeclaration | null
  narrative: string | null
}
