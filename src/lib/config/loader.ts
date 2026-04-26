import { readFileSync } from 'fs'
import { resolve } from 'path'
import yaml from 'js-yaml'
import type { GTMOSConfig } from './types'
import { setCrustdataDefaults } from '../services/crustdata'

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
  email: { provider: 'instantly' },
  linkedin: { provider: 'unipile' },
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
    slack: parsed.slack,
    email: { ...DEFAULTS.email!, ...parsed.email },
    linkedin: { ...DEFAULTS.linkedin!, ...parsed.linkedin },
  }

  // Push the crustdata default into the singleton service so calls without
  // an explicit limit honor the user's config.
  setCrustdataDefaults({ maxResultsPerQuery: _config.crustdata?.max_results_per_query })

  return _config
}

export function getConfig(): GTMOSConfig {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig(path) first.')
  }
  return _config
}

/**
 * True when the given provider value should be treated as an explicit opt-out.
 *
 * Accepts the sentinel values that mean "no provider for this slot":
 *   null, undefined, '', 'none', 'disabled' (case-insensitive).
 *
 * Used by setup, doctor, and the runtime to skip provider-specific validation
 * when the user has opted out via ~/.gtm-os/config.yaml.
 */
export function isProviderDisabled(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value !== 'string') return false
  const v = value.trim().toLowerCase()
  return v === '' || v === 'none' || v === 'disabled'
}
