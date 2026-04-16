export type QualityCheckType =
  | 'duplicate'
  | 'email_decay'
  | 'completeness'
  | 'anomaly'
  | 'freshness'
  | 'cross_campaign_overlap'

export type QualitySeverity = 'info' | 'warning' | 'critical'

export interface QualityAction {
  endpoint: string
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body: unknown
}

export interface QualityIssue {
  id: string
  resultSetId: string
  rowId: string | null
  checkType: QualityCheckType
  severity: QualitySeverity
  details: Record<string, unknown>
  nudge: string
  action: QualityAction | null
  resolved: boolean
  createdAt: string
}
