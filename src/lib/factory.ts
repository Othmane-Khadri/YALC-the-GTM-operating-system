import { ProviderRegistry, registerBuiltinProviders } from './providers/registry'
import { SkillRegistry, registerBuiltinSkills } from './skills/registry'
import { loadConfig } from './config/loader'
import type { GTMOSConfig } from './config/types'
import type { GTMFramework } from './framework/types'

export interface GTMOSOptions {
  /** Path to YAML config (default: ~/.gtm-os/config.yaml) */
  configPath?: string
  /** Inline config — merged with defaults, overrides file config */
  config?: Partial<GTMOSConfig>
  /** Pre-loaded GTM framework (skip YAML read) */
  framework?: GTMFramework
  /** Don't register built-in providers/skills — start with empty registries */
  skipBuiltins?: boolean
}

export interface GTMOSInstance {
  providers: ProviderRegistry
  skills: SkillRegistry
  config: GTMOSConfig
  framework: GTMFramework | null
}

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

/**
 * Create a configured GTM-OS instance.
 *
 * Library consumers use this instead of importing singletons:
 * ```ts
 * const gtm = createGtmOS({ configPath: './my-config.yaml' })
 * gtm.providers.register(new MyCustomProvider())
 * ```
 */
export function createGtmOS(options: GTMOSOptions = {}): GTMOSInstance {
  // Load config
  let config: GTMOSConfig
  if (options.configPath) {
    try {
      config = loadConfig(options.configPath)
    } catch {
      config = { ...DEFAULTS }
    }
  } else {
    config = { ...DEFAULTS }
  }

  // Overlay inline config
  if (options.config) {
    config = {
      notion: { ...config.notion, ...options.config.notion },
      unipile: {
        ...config.unipile,
        ...options.config.unipile,
        sequence_timing: {
          ...config.unipile.sequence_timing,
          ...options.config.unipile?.sequence_timing,
        },
      },
      qualification: { ...config.qualification, ...options.config.qualification },
    }
  }

  // Create registries
  const providers = new ProviderRegistry()
  const skills = new SkillRegistry()

  // Register built-ins unless opted out
  if (!options.skipBuiltins) {
    registerBuiltinProviders(providers)
    registerBuiltinSkills(skills)
  }

  return {
    providers,
    skills,
    config,
    framework: options.framework ?? null,
  }
}
