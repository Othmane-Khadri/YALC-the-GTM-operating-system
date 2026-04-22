// ─── Signal Detection Types ─────────────────────────────────────────────────
// Core types for the active signal/intent detection system.

export type SignalType = 'job-change' | 'hiring-surge' | 'funding' | 'news'

export const ALL_SIGNAL_TYPES: SignalType[] = ['job-change', 'hiring-surge', 'funding', 'news']

export interface SignalWatch {
  id: string
  entityType: 'company' | 'person'
  entityId: string    // domain or linkedin URL
  entityName: string
  signalTypes: SignalType[]
  baseline: Record<string, unknown>
  createdAt: string
  lastCheckedAt: string
  tenantId: string
}

export interface DetectedSignal {
  id: string
  watchId: string
  signalType: SignalType
  entityId: string
  entityName: string
  summary: string
  data: Record<string, unknown>
  detectedAt: string
  tenantId: string
}

// ─── Trigger Types ──────────────────────────────────────────────────────────

export type TriggerAction = 'enrich' | 'qualify' | 'campaign' | 'slack' | 'intelligence'

export interface TriggerConfig {
  action: TriggerAction
  channel?: string
  template?: string
  campaignId?: string
}

export interface TriggerFile {
  triggers: Partial<Record<SignalType, TriggerConfig[]>>
}

// ─── Detector Skill Types ───────────────────────────────────────────────────

export interface DetectorResult {
  changed: boolean
  summary: string
  data: Record<string, unknown>
  newBaseline: Record<string, unknown>
}

// ─── Credit Estimation ──────────────────────────────────────────────────────

export const SIGNAL_CREDIT_COSTS: Record<SignalType, number> = {
  'job-change': 3,     // people_search_db
  'hiring-surge': 1,   // job_search
  'funding': 1,        // company_enrich (cached)
  'news': 0,           // firecrawl (no Crustdata credits)
}

export function estimateDailyCreditCost(watches: SignalWatch[]): number {
  let total = 0
  for (const watch of watches) {
    for (const signalType of watch.signalTypes) {
      total += SIGNAL_CREDIT_COSTS[signalType]
    }
  }
  return total
}
