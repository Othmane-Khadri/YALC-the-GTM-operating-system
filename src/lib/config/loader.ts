import { readFileSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import type { GTMOSConfig } from './types'

const DEFAULTS: GTMOSConfig = {
  notion: {
    campaigns_ds: '',
    leads_ds: '',
    variants_ds: '',
    parent_page: '',
  },
  unipile: {
    daily_connect_limit: 30,
    sequence_timing: {
      connect_to_dm1_days: 2,
      dm1_to_dm2_days: 3,
    },
    rate_limit_ms: 3000,
  },
  qualification: {
    rules_path: '',
    exclusion_path: '',
    disqualifiers_path: '',
    cache_ttl_days: 30,
  },
}

let _config: GTMOSConfig | null = null

export function loadConfig(configPath: string): GTMOSConfig {
  const resolved = resolve(configPath)
  const raw = readFileSync(resolved, 'utf-8')
  const parsed = yaml.load(raw) as Partial<GTMOSConfig>

  _config = {
    notion: { ...DEFAULTS.notion, ...parsed.notion },
    unipile: {
      ...DEFAULTS.unipile,
      ...parsed.unipile,
      sequence_timing: {
        ...DEFAULTS.unipile.sequence_timing,
        ...parsed.unipile?.sequence_timing,
      },
    },
    qualification: { ...DEFAULTS.qualification, ...parsed.qualification },
    crustdata: { max_results_per_query: 50, ...parsed.crustdata },
    fullenrich: { poll_interval_ms: 2000, poll_timeout_ms: 300000, ...parsed.fullenrich },
    instantly: {
      daily_send_limit: 50,
      warmup_enabled: true,
      schedule: {
        timezone: 'America/New_York',
        send_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        send_hours: { start: 8, end: 17 },
        ...parsed.instantly?.schedule,
      },
      ...parsed.instantly,
    },
    slack: parsed.slack,
  }

  return _config
}

export function getConfig(): GTMOSConfig {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig(path) first.')
  }
  return _config
}
