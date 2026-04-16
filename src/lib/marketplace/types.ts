import type { SkillCategory } from '../skills/types'

export interface SkillManifest {
  id: string
  name: string
  version: string
  description: string
  category: SkillCategory
  author: string
  license: 'MIT' | 'Apache-2.0' | 'proprietary'
  repository?: string
  requiredProviders: string[]
  orthogonalApis?: string[]
  estimatedCostPerRun?: number
  main?: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  requiredCapabilities: string[]
}

export type SkillSource =
  | { type: 'npm'; package: string; version?: string }
  | { type: 'github'; repo: string; ref?: string }
  | { type: 'local'; path: string }

export interface InstallResult {
  success: boolean
  skillId: string
  version: string
  installPath: string
  message: string
}

export interface RemoteSkillInfo {
  id: string
  name: string
  version: string
  description: string
  category: SkillCategory
  author: string
  downloads?: number
  repository?: string
  requiredProviders: string[]
  estimatedCostPerRun?: number
}
