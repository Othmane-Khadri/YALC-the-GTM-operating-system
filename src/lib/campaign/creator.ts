import type { GTMOSConfig } from '../config/types'

interface CreatorOptions {
  config: GTMOSConfig
  leadsFilter?: string
  title?: string
  hypothesis?: string
}

export async function runCreator(opts: CreatorOptions): Promise<void> {
  console.log('[creator] campaign:create — not yet implemented')
  console.log('[creator] This command will be implemented in Phase 5.')
}
