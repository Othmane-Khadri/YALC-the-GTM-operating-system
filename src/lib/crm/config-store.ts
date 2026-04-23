/**
 * CRM Config Store
 *
 * Reads and writes CRM provider configs (field mappings, tool bindings)
 * from ~/.gtm-os/crm/<provider>.yaml
 *
 * Users can edit these YAML files manually — this module never
 * overwrites without explicit intent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import yaml from 'js-yaml'
import type { CRMProviderConfig } from './types'

const CRM_CONFIG_DIR = join(homedir(), '.gtm-os', 'crm')

export function getCrmConfigDir(): string {
  return CRM_CONFIG_DIR
}

export function ensureCrmConfigDir(): void {
  if (!existsSync(CRM_CONFIG_DIR)) {
    mkdirSync(CRM_CONFIG_DIR, { recursive: true })
  }
}

/**
 * Load a saved CRM provider config from YAML.
 * Returns null if no config exists.
 */
export function loadCrmConfig(provider: string): CRMProviderConfig | null {
  const filePath = join(CRM_CONFIG_DIR, `${provider}.yaml`)
  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, 'utf-8')
    return yaml.load(raw) as CRMProviderConfig
  } catch (err) {
    console.warn(`[crm] Failed to load config for ${provider}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Save a CRM provider config to YAML.
 */
export function saveCrmConfig(config: CRMProviderConfig): string {
  ensureCrmConfigDir()
  const filePath = join(CRM_CONFIG_DIR, `${config.provider}.yaml`)
  const content = yaml.dump(config, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  })
  writeFileSync(filePath, content, 'utf-8')
  return filePath
}

/**
 * List all saved CRM provider configs.
 */
export function listCrmConfigs(): string[] {
  if (!existsSync(CRM_CONFIG_DIR)) return []

  const { readdirSync } = require('fs')
  return readdirSync(CRM_CONFIG_DIR)
    .filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f: string) => f.replace(/\.ya?ml$/, ''))
}

/**
 * Delete a CRM provider config.
 */
export function deleteCrmConfig(provider: string): boolean {
  const filePath = join(CRM_CONFIG_DIR, `${provider}.yaml`)
  if (!existsSync(filePath)) return false

  const { unlinkSync } = require('fs')
  unlinkSync(filePath)
  return true
}
