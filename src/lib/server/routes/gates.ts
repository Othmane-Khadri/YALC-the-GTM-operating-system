/**
 * /api/gates/* — human-gate API surface for the SPA's /today view.
 *
 * Endpoints:
 *
 *   GET  /api/gates/awaiting
 *     List every awaiting-gate sentinel currently on disk across all
 *     installed frameworks. Sorted newest-first by `created_at`.
 *
 *   POST /api/gates/:runId/approve   { edits?: object }
 *     Mark the gate approved (writes `<run-id>.gate-approved.json`),
 *     apply optional `edits` to the payload, then call the in-process
 *     `framework:resume` to continue execution from `step_index + 1`.
 *
 *     Idempotency: a second approve on the same run returns
 *     `{ already_processed: true }` with status 200. Approve-after-reject
 *     returns 409 Conflict.
 *
 *   POST /api/gates/:runId/reject    { reason: string }
 *     Mark the gate rejected. The framework runner re-runs from step 0
 *     with `rejection_reason` threaded into vars (so the framework can
 *     either retry differently or write its own failure.json).
 *
 *     Same idempotency contract as approve.
 */

import { Hono } from 'hono'
import {
  GateConflictError,
  GateNotFoundError,
  findFrameworkByRunId,
  listAwaitingGates,
  writeApproved,
  writeRejected,
} from '../../frameworks/gates.js'
import { runFrameworkResume } from '../../../cli/commands/framework.js'

export const gatesRoutes = new Hono()

// ─── GET /api/gates/awaiting ────────────────────────────────────────────────

gatesRoutes.get('/awaiting', (c) => {
  const items = listAwaitingGates().sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  )
  return c.json({ items, total: items.length })
})

// ─── POST /api/gates/:runId/approve ─────────────────────────────────────────

gatesRoutes.post('/:runId/approve', async (c) => {
  const runId = c.req.param('runId')
  if (!runId) return c.json({ error: 'bad_request', message: 'runId required' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const edits =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).edits
      : undefined

  const framework = findFrameworkByRunId(runId)
  if (!framework) {
    return c.json({ error: 'not_found', message: `No gate for run ${runId}` }, 404)
  }

  let approveResult
  try {
    approveResult = writeApproved(framework, runId, edits)
  } catch (err) {
    if (err instanceof GateConflictError) {
      return c.json(
        {
          error: 'conflict',
          message: err.message,
          conflict_with: err.conflictWith,
          framework,
          run_id: runId,
        },
        409,
      )
    }
    if (err instanceof GateNotFoundError) {
      return c.json({ error: 'not_found', message: err.message }, 404)
    }
    return c.json(
      { error: 'internal', message: err instanceof Error ? err.message : 'approve failed' },
      500,
    )
  }

  if (approveResult.alreadyProcessed) {
    return c.json({
      ok: true,
      already_processed: true,
      framework,
      run_id: runId,
      approved: approveResult.approved,
    })
  }

  // First-time approve: trigger the in-process resume.
  try {
    const resume = await runFrameworkResume(framework, { fromGate: runId })
    return c.json({
      ok: true,
      already_processed: false,
      framework,
      run_id: runId,
      approved: approveResult.approved,
      resumed: resume,
    })
  } catch (err) {
    return c.json(
      {
        error: 'resume_failed',
        message: err instanceof Error ? err.message : 'resume failed',
        framework,
        run_id: runId,
        approved: approveResult.approved,
      },
      500,
    )
  }
})

// ─── POST /api/gates/:runId/reject ──────────────────────────────────────────

gatesRoutes.post('/:runId/reject', async (c) => {
  const runId = c.req.param('runId')
  if (!runId) return c.json({ error: 'bad_request', message: 'runId required' }, 400)

  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    body = {}
  }
  const reason =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>).reason
      : undefined
  if (typeof reason !== 'string' || reason.length === 0) {
    return c.json({ error: 'bad_request', message: 'reason is required' }, 400)
  }

  const framework = findFrameworkByRunId(runId)
  if (!framework) {
    return c.json({ error: 'not_found', message: `No gate for run ${runId}` }, 404)
  }

  let rejectResult
  try {
    rejectResult = writeRejected(framework, runId, reason)
  } catch (err) {
    if (err instanceof GateConflictError) {
      return c.json(
        {
          error: 'conflict',
          message: err.message,
          conflict_with: err.conflictWith,
          framework,
          run_id: runId,
        },
        409,
      )
    }
    if (err instanceof GateNotFoundError) {
      return c.json({ error: 'not_found', message: err.message }, 404)
    }
    return c.json(
      { error: 'internal', message: err instanceof Error ? err.message : 'reject failed' },
      500,
    )
  }

  if (rejectResult.alreadyProcessed) {
    return c.json({
      ok: true,
      already_processed: true,
      framework,
      run_id: runId,
      rejected: rejectResult.rejected,
    })
  }

  try {
    const resume = await runFrameworkResume(framework, { fromGate: runId })
    return c.json({
      ok: true,
      already_processed: false,
      framework,
      run_id: runId,
      rejected: rejectResult.rejected,
      resumed: resume,
    })
  } catch (err) {
    return c.json(
      {
        error: 'resume_failed',
        message: err instanceof Error ? err.message : 'resume failed',
        framework,
        run_id: runId,
        rejected: rejectResult.rejected,
      },
      500,
    )
  }
})
