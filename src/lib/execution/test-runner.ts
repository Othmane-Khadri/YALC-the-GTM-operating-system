import { getRegistry } from '../providers/registry'
import { runImport } from '../qualification/importers'
import { runQualify } from '../qualification/pipeline'
import { collectFeedback } from './feedback-collector'
import type { GTMOSConfig } from '../config/types'

export async function runTestBatch(config: GTMOSConfig, count = 10): Promise<void> {
  console.log(`[test-run] Starting test batch with ${count} leads...\n`)

  const registry = getRegistry()

  // Step 1: Find companies using best available search provider
  console.log('[test-run] Step 1: Finding companies...')
  let searchRows: Record<string, unknown>[] = []

  try {
    const searchProvider = registry.resolve({ stepType: 'search', provider: 'auto' })
    console.log(`[test-run] Using provider: ${searchProvider.name}`)

    const results = searchProvider.execute(
      {
        stepIndex: 0,
        title: 'Find Companies',
        stepType: 'search',
        provider: 'auto',
        description: 'Find target companies',
        estimatedRows: count,
      },
      {
        frameworkContext: '',
        batchSize: count,
        totalRequested: count,
      }
    )

    for await (const batch of results) {
      searchRows.push(...batch.rows)
    }
  } catch (err) {
    console.log(`[test-run] Search failed: ${err instanceof Error ? err.message : err}`)
    console.log('[test-run] Using mock provider...')

    const mockProvider = registry.resolve({ stepType: 'search', provider: 'mock' })
    const results = mockProvider.execute(
      {
        stepIndex: 0,
        title: 'Find Companies (Mock)',
        stepType: 'search',
        provider: 'mock',
        description: 'Generate mock test companies',
        estimatedRows: count,
      },
      {
        frameworkContext: '',
        batchSize: count,
        totalRequested: count,
      }
    )

    for await (const batch of results) {
      searchRows.push(...batch.rows)
    }
  }

  console.log(`[test-run] Found ${searchRows.length} companies`)

  if (searchRows.length === 0) {
    console.log('[test-run] No results. Check your provider configuration.')
    return
  }

  // Step 2: Enrich
  console.log('\n[test-run] Step 2: Enriching leads...')
  try {
    const enrichProvider = registry.resolve({ stepType: 'enrich', provider: 'auto' })
    const enrichResults = enrichProvider.execute(
      {
        stepIndex: 1,
        title: 'Enrich',
        stepType: 'enrich',
        provider: 'auto',
        description: 'Enrich company data',
      },
      {
        frameworkContext: '',
        previousStepRows: searchRows,
        batchSize: 25,
        totalRequested: searchRows.length,
      }
    )

    const enrichedRows: Record<string, unknown>[] = []
    for await (const batch of enrichResults) {
      enrichedRows.push(...batch.rows)
    }
    if (enrichedRows.length > 0) searchRows = enrichedRows
    console.log(`[test-run] Enriched ${searchRows.length} leads`)
  } catch (err) {
    console.log(`[test-run] Enrichment skipped: ${err instanceof Error ? err.message : err}`)
  }

  // Step 3: Import into result set
  console.log('\n[test-run] Step 3: Importing into result set...')
  const tmpPath = `/tmp/gtm-os-test-${Date.now()}.json`
  const { writeFileSync } = await import('fs')
  writeFileSync(tmpPath, JSON.stringify(searchRows))

  const imported = await runImport({ config, source: 'json', input: tmpPath })
  console.log(`[test-run] Imported as result set: ${imported.resultSetId}`)

  // Step 4: Qualify
  console.log('\n[test-run] Step 4: Running qualification pipeline...')
  await runQualify({ config, resultSetId: imported.resultSetId })

  // Step 5: Display results
  console.log('\n[test-run] Step 5: Results table:')
  for (const row of searchRows.slice(0, 10)) {
    console.log(`  ${String(row.company_name ?? row.name ?? '?').padEnd(30)} | ${String(row.industry ?? '').padEnd(20)} | Score: ${row.icp_score ?? '—'}`)
  }

  // Step 6: Collect feedback
  console.log('\n[test-run] Step 6: Review your results...')
  await collectFeedback(imported.resultSetId)

  console.log('\n[test-run] Test batch complete. Intelligence has been updated.')
  console.log('[test-run] Run "gtm-os test-run" again to see improved results.')
}
