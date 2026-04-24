export interface NotionConfig {
  campaigns_ds: string
  leads_ds: string
  variants_ds: string
  parent_page: string
}

export interface UnipileConfig {
  daily_connect_limit: number
  sequence_timing: {
    connect_to_dm1_days: number
    dm1_to_dm2_days: number
  }
  rate_limit_ms: number
}

export interface QualificationConfig {
  rules_path: string
  exclusion_path: string
  disqualifiers_path: string
  cache_ttl_days: number
}

export interface CrustdataConfig {
  max_results_per_query: number
}

export interface FullEnrichConfig {
  poll_interval_ms: number
  poll_timeout_ms: number
}

export interface InstantlyConfig {
  daily_send_limit: number
  warmup_enabled: boolean
  schedule: {
    timezone: string
    send_days: string[]
    send_hours: { start: number; end: number }
  }
}

export interface SlackConfig {
  webhook_url: string
  notify_on: string[] // ['reply', 'demo_booked', 'deal_created', 'winner_declared', 'campaign_completed']
}

export interface GTMOSConfig {
  notion: NotionConfig
  unipile: UnipileConfig
  qualification: QualificationConfig
  crustdata?: CrustdataConfig
  fullenrich?: FullEnrichConfig
  instantly?: InstantlyConfig
  slack?: SlackConfig
}
