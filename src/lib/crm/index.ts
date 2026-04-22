/**
 * CRM Module — public API
 *
 * Re-exports everything needed to use CRM integrations.
 */

export type {
  CRMAdapter,
  CRMFilter,
  FieldMapping,
  PushResult,
  SyncConfig,
  SyncResult,
  CRMObjectInfo,
  CRMFieldInfo,
  DriftReport,
  CRMProviderConfig,
  CRMObjectMapping,
} from './types'

export { McpCrmAdapter } from './mcp-crm-adapter'
export { runCrmSetupWizard } from './setup-wizard'
export type { SetupWizardOptions, SetupWizardResult } from './setup-wizard'
export { loadCrmConfig, saveCrmConfig, listCrmConfigs, getCrmConfigDir } from './config-store'
export { autoMapFields, fieldSimilarity, applyMapping, GTM_CANONICAL_FIELDS } from './field-mapper'
