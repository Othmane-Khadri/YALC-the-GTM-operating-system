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

export interface GTMOSConfig {
  notion: NotionConfig
  unipile: UnipileConfig
  qualification: QualificationConfig
}
