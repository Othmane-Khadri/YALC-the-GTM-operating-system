import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { workflows, workflowSteps, resultSets, resultRows } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { buildColumnsFromSteps } from '@/lib/execution/columns'
import { buildFrameworkContext } from '@/lib/framework/context'
import { frameworks } from '@/lib/db/schema'
import { getRegistry } from '@/lib/providers/registry'
import { ProviderIntelligence } from '@/lib/providers/intelligence'
import { getCollector } from '@/lib/signals/collector'
import type { WorkflowDefinition } from '@/lib/ai/types'
import type { GTMFramework } from '@/lib/framework/types'
import type { WorkflowStepInput } from '@/lib/providers/types'

export const runtime = 'nodejs'

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

export async function POST(req: NextRequest) {
  const { conversationId, workflow } = await req.json() as {
    conversationId: string
    workflow: WorkflowDefinition
  }

  const encoder = new TextEncoder()

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
        const workflowId = crypto.randomUUID()
        await db.insert(workflows).values({
          id: workflowId,
          conversationId,
          title: workflow.title,
          description: workflow.description,
          status: 'running',
          stepsDefinition: JSON.stringify(workflow.steps),
          startedAt: new Date(),
        })

        // Create result set
        const resultSetId = crypto.randomUUID()
        await db.insert(resultSets).values({
          id: resultSetId,
          workflowId,
          name: workflow.title,
          columnsDefinition: JSON.stringify(columns),
          rowCount: 0,
        })

        // Create workflow steps
        for (const step of workflow.steps) {
          await db.insert(workflowSteps).values({
            workflowId,
            stepIndex: step.stepIndex,
            stepType: step.stepType,
            provider: step.provider,
            config: JSON.stringify(step.config ?? {}),
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

        let totalSoFar = 0
        const registry = getRegistry()
        const providerIntelligence = new ProviderIntelligence()

        // Execute each step
        for (const step of workflow.steps) {
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
          const executor = await registry.resolveAsync({ stepType: step.stepType, provider: step.provider })
          console.log(`Resolved provider: ${executor.id} for step ${step.stepType}`)

          // For search/enrich/qualify steps, execute via provider
          if (step.stepType === 'search' || step.stepType === 'enrich' || step.stepType === 'qualify') {
            const stepInput: WorkflowStepInput = {
              stepIndex: step.stepIndex,
              title: step.title,
              stepType: step.stepType,
              provider: step.provider,
              description: step.description,
              estimatedRows: step.estimatedRows,
              config: step.config,
            }

            const context = {
              frameworkContext,
              batchSize: 10,
              totalRequested: Math.min(step.estimatedRows || totalRequested, totalRequested - totalSoFar),
            }

            const stepStartTime = Date.now()
            let stepRowCount = 0

            for await (const batch of executor.execute(stepInput, context)) {
              // Insert rows into DB
              const rowsToInsert = batch.rows.map((lead, idx) => ({
                resultSetId,
                rowIndex: totalSoFar + idx,
                data: JSON.stringify(lead),
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

            // Record provider performance
            const latencyMs = Date.now() - stepStartTime
            await providerIntelligence.recordExecution(
              executor.id,
              { stepType: step.stepType },
              { rowCount: stepRowCount, latencyMs, costEstimate: currentStep?.costEstimate ?? 0 },
            )

            // Emit provider performance signal
            await getCollector().emit({
              type: 'provider_performance',
              category: 'provider',
              data: {
                providerId: executor.id,
                stepType: step.stepType,
                metrics: { rowCount: stepRowCount, latencyMs, costEstimate: currentStep?.costEstimate ?? 0 },
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
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
