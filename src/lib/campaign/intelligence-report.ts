import type { GTMOSConfig } from '../config/types'

interface ReportOptions {
  config: GTMOSConfig
  week?: string
}

export async function runReport(opts: ReportOptions): Promise<void> {
  console.log('[report] campaign:report — not yet implemented')
  console.log('[report] This command will be implemented in Phase 4.')
}
