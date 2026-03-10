import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { workflows, workflowSteps, resultSets, resultRows, knowledgeItems } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import { buildColumnsFromSteps } from '@/lib/execution/columns'
import { buildFrameworkContext } from '@/lib/framework/context'
import { frameworks } from '@/lib/db/schema'
import { getRegistry } from '@/lib/providers/registry'
import { ProviderIntelligence } from '@/lib/providers/intelligence'
import { getCollector } from '@/lib/signals/collector'
import type { WorkflowDefinition } from '@/lib/ai/types'
import type { GTMFramework } from '@/lib/framework/types'
import type { WorkflowStepInput, ExecutionContext } from '@/lib/providers/types'
import type { ColumnDef } from '@/lib/ai/types'
import { APIFY_CATALOG } from '@/lib/providers/builtin/apify-catalog'
import { ensureApifyMcp } from '@/lib/mcp/apify-auto-connect'

export const runtime = 'nodejs'

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export async function POST(req: NextRequest) {
  const { conversationId, workflow } = await req.json() as {
    conversationId: string
    workflow: WorkflowDefinition
  }

  if (!workflow?.steps || !Array.isArray(workflow.steps) || workflow.steps.length === 0) {
    return Response.json(
      { error: 'Invalid workflow: steps must be a non-empty array' },
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()

  let cancelled = false
  let workflowId = ''

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseData(obj)))
      }

      try {
        // Build columns from workflow steps
        const columns = buildColumnsFromSteps(workflow.steps)
        const totalRequested = workflow.estimatedResultCount || 50

        // Create workflow row
        workflowId = crypto.randomUUID()
        await db.insert(workflows).values({
          id: workflowId,
          conversationId,
          title: workflow.title,
          description: workflow.description,
          status: 'running',
          stepsDefinition: workflow.steps,
          startedAt: new Date(),
        })

        // Create result set
        const resultSetId = crypto.randomUUID()
        await db.insert(resultSets).values({
          id: resultSetId,
          workflowId,
          name: workflow.title,
          columnsDefinition: columns,
          rowCount: 0,
        })

        // Create workflow steps
        for (const step of workflow.steps) {
          await db.insert(workflowSteps).values({
            workflowId,
            stepIndex: step.stepIndex,
            stepType: step.stepType,
            provider: step.provider,
            config: step.config ?? {},
            status: 'pending',
          })
        }

        send({
          type: 'execution_start',
          workflowId,
          resultSetId,
        })

        // Fetch framework context for mock generation
        let frameworkContext = ''
        try {
          const [fw] = await db.select().from(frameworks).where(eq(frameworks.userId, 'default')).limit(1)
          if (fw?.data) {
            frameworkContext = await buildFrameworkContext(fw.data as GTMFramework)
          }
        } catch {
          // No framework — proceed without context
        }

        // Fetch knowledge context for mock generation
        let knowledgeContext = ''
        try {
          const knowledgeRows = await db.select({
            title: knowledgeItems.title,
            extractedText: knowledgeItems.extractedText,
          })
          .from(knowledgeItems)
          .orderBy(sql`${knowledgeItems.createdAt} DESC`)
          .limit(3)

          if (knowledgeRows.length > 0) {
            knowledgeContext = knowledgeRows
              .map(k => `### ${k.title}\n${k.extractedText?.slice(0, 2000) ?? ''}`)
              .join('\n\n')
          }
        } catch {
          // No knowledge items — proceed without context
        }

        // Fetch learnings for qualification context
        let learningsContext = ''
        try {
          const [fw] = await db.select().from(frameworks).where(eq(frameworks.userId, 'default')).limit(1)
          if (fw?.data) {
            const framework = fw.data as GTMFramework
            const validated = (framework.learnings || []).filter(
              (l: { confidence: string }) => l.confidence === 'validated' || l.confidence === 'proven'
            )
            if (validated.length > 0) {
              learningsContext = validated
                .slice(-10)
                .map((l: { insight: string; confidence: string }) => `- [${l.confidence}] ${l.insight}`)
                .join('\n')
            }
          }
        } catch {
          // No learnings — proceed without
        }

        let totalSoFar = 0
        let previousStepRows: Record<string, unknown>[] = []
        const registry = getRegistry()
        const providerIntelligence = new ProviderIntelligence()

        // Ensure Apify MCP server is connected for dynamic actor discovery
        await ensureApifyMcp()

        // Pre-flight: verify all providers are resolvable before starting execution
        for (const step of workflow.steps) {
          if (step.stepType === 'filter' || step.stepType === 'export') continue
          try {
            await registry.resolveAsync({ stepType: step.stepType, provider: step.provider })
          } catch (resolveErr) {
            const msg = resolveErr instanceof Error ? resolveErr.message : 'Unknown'
            send({
              type: 'error',
              error: `Pre-flight check failed: provider "${step.provider}" for step "${step.title}" is not available (${msg}). Fix provider configuration before running.`,
            })
            controller.close()
            return
          }
        }

        // Execute each step
        for (const step of workflow.steps) {
          if (cancelled) break
          send({
            type: 'step_start',
            stepIndex: step.stepIndex,
            stepTitle: step.title,
          })

          // Update step status
          const stepRows = await db.select().from(workflowSteps)
            .where(eq(workflowSteps.workflowId, workflowId))
          const currentStep = stepRows.find(s => s.stepIndex === step.stepIndex)
          if (currentStep) {
            await db.update(workflowSteps)
              .set({ status: 'running', startedAt: new Date() })
              .where(eq(workflowSteps.id, currentStep.id))
          }

          // Resolve provider via registry (async version uses intelligence)
          let executor = await registry.resolveAsync({ stepType: step.stepType, provider: step.provider })
          console.log(`[Step ${step.stepIndex}] Requested: "${step.provider}" → Resolved: "${executor.id}" (${executor.type})`)

          // Always surface provider resolution to the client for debugging
          send({
            type: 'step_note',
            stepIndex: step.stepIndex,
            message: `Provider: "${step.provider}" → ${executor.id} (${executor.type})`,
          })

          // Warn user when mock is used as primary executor (not via fallback)
          if (executor.id === 'mock' && step.provider !== 'mock') {
            send({
              type: 'step_warning',
              stepIndex: step.stepIndex,
              message: `Provider "${step.provider}" not found in registry — using simulated data. Check that provider IDs match the catalog and API keys are set.`,
            })
          }

          // Filter/export steps: passthrough (no provider execution needed)
          if (step.stepType === 'filter') {
            send({
              type: 'step_note',
              stepIndex: step.stepIndex,
              message: 'Filter step: rule-based filtering runs client-side on the result table.',
            })
          } else if (step.stepType === 'export') {
            send({
              type: 'step_note',
              stepIndex: step.stepIndex,
              message: 'Export step: CSV/CRM export coming soon. Results are available in the table.',
            })
          } else if (step.stepType === 'search' || step.stepType === 'enrich' || step.stepType === 'qualify') {
            const stepInput: WorkflowStepInput = {
              stepIndex: step.stepIndex,
              title: step.title,
              stepType: step.stepType,
              provider: step.provider,
              description: step.description,
              estimatedRows: step.estimatedRows,
              config: step.config,
            }

            const context: ExecutionContext = {
              frameworkContext,
              knowledgeContext,
              learningsContext,
              previousStepRows: previousStepRows.length > 0 ? previousStepRows : undefined,
              batchSize: 10,
              totalRequested: Math.min(step.estimatedRows || totalRequested, totalRequested - totalSoFar),
            }

            const stepStartTime = Date.now()
            let stepRowCount = 0
            let usedExecutor = executor

            // Graceful fallback: if provider throws, fall back to mock
            try {
              for await (const batch of executor.execute(stepInput, context)) {
                if (step.stepType === 'qualify' && previousStepRows.length > 0) {
                  // Qualify: update existing rows in-place with scored data
                  const existingRows = await db.select().from(resultRows)
                    .where(eq(resultRows.resultSetId, resultSetId))
                  for (let ri = 0; ri < batch.rows.length; ri++) {
                    const row = batch.rows[ri]
                    // Match by stable key (name, linkedin_url, email, url) instead of array index
                    const rowData = row as Record<string, unknown>
                    let existing = existingRows.find(e => {
                      const d = (typeof e.data === 'string' ? (() => { try { return JSON.parse(e.data) } catch { return {} } })() : e.data) as Record<string, unknown>
                      for (const key of ['linkedin_url', 'email', 'url', 'name']) {
                        if (rowData[key] && d[key] && String(rowData[key]) === String(d[key])) return true
                      }
                      return false
                    })
                    // Fallback to index-based matching if no key match found
                    if (!existing) {
                      const fallbackIndex = ri + (batch.batchIndex * context.batchSize)
                      existing = existingRows[fallbackIndex]
                    }
                    if (existing) {
                      await db.update(resultRows)
                        .set({ data: row, updatedAt: new Date() })
                        .where(eq(resultRows.id, existing.id))
                    }
                  }
                  stepRowCount += batch.rows.length
                } else {
                  // Search/Enrich: insert new rows
                  const rowsToInsert = batch.rows.map((lead, idx) => ({
                    resultSetId,
                    rowIndex: totalSoFar + idx,
                    data: lead,
                  }))

                  if (rowsToInsert.length > 0) {
                    await db.insert(resultRows).values(rowsToInsert)
                  }

                  totalSoFar += batch.rows.length
                  stepRowCount += batch.rows.length
                }

                send({
                  type: 'row_batch',
                  rows: batch.rows,
                  totalSoFar,
                })
              }
            } catch (providerErr) {
              const errMsg = providerErr instanceof Error ? providerErr.message : 'Provider failed'
              console.warn(`Provider ${executor.id} failed: ${errMsg}. Falling back to mock.`)
              send({
                type: 'step_warning',
                stepIndex: step.stepIndex,
                message: `Provider "${executor.id}" failed: ${errMsg}. Falling back to simulated data.`,
              })

              // Resolve mock provider and re-execute
              usedExecutor = registry.resolve({ stepType: step.stepType, provider: 'mock' })
              for await (const batch of usedExecutor.execute(stepInput, context)) {
                const rowsToInsert = batch.rows.map((lead, idx) => ({
                  resultSetId,
                  rowIndex: totalSoFar + idx,
                  data: lead,
                }))

                if (rowsToInsert.length > 0) {
                  await db.insert(resultRows).values(rowsToInsert)
                }

                totalSoFar += batch.rows.length
                stepRowCount += batch.rows.length

                send({
                  type: 'row_batch',
                  rows: batch.rows,
                  totalSoFar,
                })
              }
            }

            // Collect rows for the next step to consume
            if (step.stepType === 'search' || step.stepType === 'enrich') {
              const stepResultRows = await db.select({ data: resultRows.data })
                .from(resultRows)
                .where(eq(resultRows.resultSetId, resultSetId))
              previousStepRows = stepResultRows.map(r => {
                // Handle both parsed (new) and double-encoded string (old) data
                const d = r.data
                if (typeof d === 'string') {
                  try { return JSON.parse(d) as Record<string, unknown> } catch { return {} }
                }
                return d as Record<string, unknown>
              })
            }

            // After qualify step, merge qualify columns into result set
            if (step.stepType === 'qualify') {
              const currentColsRow = await db.select({ c: resultSets.columnsDefinition })
                .from(resultSets).where(eq(resultSets.id, resultSetId))
              // Recursively unwrap any level of string-encoding
              let rawCols: unknown = currentColsRow[0]?.c
              while (typeof rawCols === 'string') {
                try { rawCols = JSON.parse(rawCols) } catch { break }
              }
              const currentCols: ColumnDef[] = Array.isArray(rawCols) ? rawCols : []
              const qualifyCols: ColumnDef[] = [
                { key: 'icp_score', label: 'ICP Score', type: 'score' },
                { key: 'icp_fit_level', label: 'Fit Level', type: 'badge' },
                { key: 'qualification_reason', label: 'Qualification Reason', type: 'text' },
                { key: 'qualification_signals', label: 'Signals', type: 'text' },
              ]
              const mergedCols = [...currentCols]
              for (const qc of qualifyCols) {
                if (!mergedCols.find(c => c.key === qc.key)) {
                  mergedCols.push(qc)
                }
              }
              await db.update(resultSets)
                .set({ columnsDefinition: mergedCols })
                .where(eq(resultSets.id, resultSetId))

              send({
                type: 'columns_updated',
                columns: mergedCols,
              })
            }

            // Record provider performance with cost estimation
            const latencyMs = Date.now() - stepStartTime
            const catalogEntry = APIFY_CATALOG.find(e => e.id === usedExecutor.id)
            const estimatedCost = catalogEntry
              ? (stepRowCount / 1000) * catalogEntry.costPer1k
              : (currentStep?.costEstimate ?? 0)

            await providerIntelligence.recordExecution(
              usedExecutor.id,
              { stepType: step.stepType },
              { rowCount: stepRowCount, latencyMs, costEstimate: estimatedCost },
            )

            // Update step with cost estimate
            if (currentStep && estimatedCost > 0) {
              await db.update(workflowSteps)
                .set({ costEstimate: estimatedCost })
                .where(eq(workflowSteps.id, currentStep.id))
            }

            // Emit provider performance signal
            await getCollector().emit({
              type: 'provider_performance',
              category: 'provider',
              data: {
                providerId: usedExecutor.id,
                stepType: step.stepType,
                metrics: { rowCount: stepRowCount, latencyMs, costEstimate: estimatedCost },
              },
            })
          }

          // Mark step complete
          if (currentStep) {
            await db.update(workflowSteps)
              .set({
                status: 'completed',
                rowsOut: totalSoFar,
                completedAt: new Date(),
              })
              .where(eq(workflowSteps.id, currentStep.id))
          }

          send({
            type: 'step_complete',
            stepIndex: step.stepIndex,
            rowsOut: totalSoFar,
          })
        }

        // Update result set row count
        await db.update(resultSets)
          .set({ rowCount: totalSoFar })
          .where(eq(resultSets.id, resultSetId))

        // Mark workflow complete
        await db.update(workflows)
          .set({
            status: 'completed',
            resultCount: totalSoFar,
            completedAt: new Date(),
          })
          .where(eq(workflows.id, workflowId))

        send({
          type: 'execution_complete',
          resultSetId,
          totalRows: totalSoFar,
        })

        // Fire and forget — data quality check runs after response
        import('@/lib/data-quality/monitor').then(({ DataQualityMonitor }) => {
          new DataQualityMonitor().runAll(resultSetId).catch(err =>
            console.error('Data quality check failed:', err)
          )
        }).catch(err => console.error('Failed to load DataQualityMonitor:', err))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Execution failed'
        send({ type: 'error', error: message })
      } finally {
        controller.close()
      }
    },
    cancel() {
      cancelled = true
      if (workflowId) {
        db.update(workflows)
          .set({ status: 'cancelled', completedAt: new Date() })
          .where(eq(workflows.id, workflowId))
          .catch(err => console.error('Failed to cancel workflow in DB:', err))
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
