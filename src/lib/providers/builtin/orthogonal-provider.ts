import type { StepExecutor, RowBatch, ExecutionContext, WorkflowStepInput, ProviderCapability } from '../types'
import type { ColumnDef } from '@/lib/ai/types'
import { orthogonalService } from '@/lib/services/orthogonal'

export class OrthogonalProvider implements StepExecutor {
  id = 'orthogonal'
  name = 'Orthogonal'
  description = 'Universal API gateway — discover and call 100+ APIs (enrichment, scraping, search, AI) via Orthogonal. Pay-per-call, no individual API keys needed.'
  type = 'builtin' as const
  capabilities: ProviderCapability[] = ['search', 'enrich', 'custom']

  isAvailable(): boolean {
    return orthogonalService.isAvailable()
  }

  canExecute(step: WorkflowStepInput): boolean {
    // Explicit opt-in only — never auto-fallback (per-call costs).
    if (step.provider === 'orthogonal') return true
    // Or if user supplied an explicit api + path config (treated as explicit opt-in).
    if (step.config?.api && step.config?.path) return true
    return false
  }

  async *execute(step: WorkflowStepInput, _context: ExecutionContext): AsyncIterable<RowBatch> {
    const config = step.config ?? {}
    let api = config.api as string | undefined
    let path = config.path as string | undefined
    const payload = (config.payload ?? config.body ?? {}) as Record<string, unknown>

    // Pre-flight balance check — abort if balance < $1 (configurable via env)
    const minBalance = Number(process.env.ORTHOGONAL_MIN_BALANCE ?? '1')
    try {
      const balance = await orthogonalService.getBalance()
      const balanceNum = Number(balance.balance)
      if (Number.isFinite(balanceNum) && balanceNum < minBalance) {
        throw new Error(`Orthogonal balance too low: $${balance.balance} < $${minBalance} minimum. Top up at orthogonal.dev.`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Orthogonal balance too low')) throw err
      // If balance check itself fails (network), continue — the run() will surface the real error
      console.warn('[orthogonal] balance check failed, proceeding:', err)
    }

    if (!api || !path) {
      const searchPrompt = step.description || step.title || 'API'
      const searchResult = await orthogonalService.search(searchPrompt, 5)
      if (searchResult.results.length === 0 || searchResult.results[0].endpoints.length === 0) {
        throw new Error(`Orthogonal: no API found for "${searchPrompt}". Try a more specific description.`)
      }
      const bestApi = searchResult.results[0]
      const bestEndpoint = bestApi.endpoints.sort((a, b) => b.score - a.score)[0]
      api = bestApi.slug
      path = bestEndpoint.path
    }

    const result = await orthogonalService.run(api, path, payload)
    if (!result.success) {
      throw new Error(`Orthogonal run failed: ${JSON.stringify(result.data)}`)
    }

    const data = result.data
    const rows: Record<string, unknown>[] = Array.isArray(data)
      ? data.map(item => (typeof item === 'object' && item !== null ? item : { value: item }) as Record<string, unknown>)
      : [data]

    yield { rows, batchIndex: 0, totalSoFar: rows.length }
  }

  getColumnDefinitions(_step: WorkflowStepInput): ColumnDef[] {
    return [
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'email', label: 'Email', type: 'text' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'title', label: 'Title', type: 'text' },
      { key: 'url', label: 'URL', type: 'url' },
    ]
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      const balance = await orthogonalService.getBalance()
      return { ok: true, message: `Orthogonal connected. Balance: $${balance.balance}` }
    } catch (err) {
      return { ok: false, message: `Orthogonal unreachable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
}
