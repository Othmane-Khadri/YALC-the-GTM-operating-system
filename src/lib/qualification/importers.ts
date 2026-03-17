import type { GTMOSConfig } from '../config/types'

interface ImportOptions {
  config: GTMOSConfig
  source: string
  input: string
}

export async function runImport(opts: ImportOptions): Promise<void> {
  console.log('[import] leads:import — not yet implemented')
  console.log('[import] This command will be implemented in Phase 3.')
}
