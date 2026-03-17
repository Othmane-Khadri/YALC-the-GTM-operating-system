import type { GTMOSConfig } from '../config/types'

interface QualifyOptions {
  config: GTMOSConfig
  source: string
  input: string
}

export async function runQualify(opts: QualifyOptions): Promise<void> {
  console.log('[qualify] leads:qualify — not yet implemented')
  console.log('[qualify] This command will be implemented in Phase 3.')
}
