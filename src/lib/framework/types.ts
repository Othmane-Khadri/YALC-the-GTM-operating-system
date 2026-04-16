// ─── GTM Framework Types ─────────────────────────────────────────────────────
// The complete GTM context for a user's business. Populated during onboarding,
// injected into every Claude interaction to personalize workflows.

export interface GTMFramework {
  // ─── Company Identity ─────────────────────────────────────────
  company: {
    name: string
    website: string
    linkedinUrl: string
    industry: string
    subIndustry: string
    stage: CompanyStage
    description: string
    teamSize: string
    foundedYear: number
    headquarters: string
  }

  // ─── Positioning ──────────────────────────────────────────────
  positioning: {
    valueProp: string
    tagline: string
    category: string
    differentiators: string[]
    proofPoints: string[]
    competitors: CompetitorProfile[]
  }

  // ─── ICP Segments ─────────────────────────────────────────────
  segments: ICPSegment[]

  // ─── Channels ─────────────────────────────────────────────────
  channels: {
    active: ChannelType[]
    preferences: Partial<Record<ChannelType, ChannelConfig>>
  }

  // ─── Signals & Intent ─────────────────────────────────────────
  signals: {
    buyingIntentSignals: string[]
    monitoringKeywords: string[]
    triggerEvents: string[]
  }

  // ─── Objection Library ────────────────────────────────────────
  objections: Objection[]

  // ─── Campaign Learnings ───────────────────────────────────────
  learnings: Learning[]

  // ─── System State ─────────────────────────────────────────────
  connectedProviders: string[]
  onboardingComplete: boolean
  lastUpdated: string
  version: number
}

export type CompanyStage =
  | 'pre-seed'
  | 'seed'
  | 'series-a'
  | 'series-b'
  | 'growth'
  | 'enterprise'

export interface CompetitorProfile {
  name: string
  website: string
  positioning: string
  weaknesses: string[]
  battlecardNotes: string
}

export interface ICPSegment {
  id: string
  name: string
  description: string
  priority: 'primary' | 'secondary' | 'exploratory'

  targetRoles: string[]
  targetCompanySizes: string[]
  targetIndustries: string[]
  /**
   * Optional: which company stages this segment targets. When populated with
   * early stages ('pre-seed' | 'seed'), providers like Crustdata's
   * people_search_db are skipped in favor of Unipile profile lookups because
   * early-stage companies rarely have indexed LinkedIn employee rosters and
   * the Crustdata credit spend is wasted. (Phase 2 / P2.4)
   */
  targetCompanyStages?: CompanyStage[]
  keyDecisionMakers: string[]

  painPoints: string[]
  buyingTriggers: string[]
  disqualifiers: string[]

  voice: SegmentVoice
  messaging: SegmentMessaging
  contentStrategy: SegmentContentStrategy
}

export interface SegmentVoice {
  tone: string
  style: string
  keyPhrases: string[]
  avoidPhrases: string[]
  writingRules: string[]
  exampleSentences: string[]
}

export interface SegmentMessaging {
  framework: string
  elevatorPitch: string
  keyMessages: string[]
  objectionHandling: Array<{
    objection: string
    response: string
  }>
}

export interface SegmentContentStrategy {
  linkedinPostTypes: string[]
  emailCadence: string
  contentThemes: string[]
  redditSubreddits: string[]
  keyTopics: string[]
}

export type ChannelType =
  | 'linkedin'
  | 'email'
  | 'reddit'
  | 'twitter'
  | 'cold-call'
  | 'events'
  | 'partnerships'
  | 'content-marketing'
  | 'paid-ads'

export interface ChannelConfig {
  frequency: string
  style: string
  notes: string
}

export interface Objection {
  id: string
  objection: string
  context: string
  response: string
  segment: string
}

export interface Learning {
  id: string
  date: string
  insight: string
  source: 'campaign' | 'feedback' | 'manual' | 'rlhf'
  segment: string
  confidence: 'hypothesis' | 'validated' | 'proven'
}

// Re-export from intelligence system
export type { Intelligence } from '../intelligence/types'
