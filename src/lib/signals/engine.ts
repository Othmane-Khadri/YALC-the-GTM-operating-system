// ─── Signal Detection Engine ────────────────────────────────────────────────
// Orchestrates watches, runs detectors, deduplicates signals, feeds
// intelligence store and signals_log.

import { randomUUID } from 'crypto'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../db'
import { signalWatches, signalsLog } from '../db/schema'
import { IntelligenceStore } from '../intelligence/store'
import { executeTriggers, loadTriggerConfig } from './triggers'
import type {
  SignalWatch,
  DetectedSignal,
  SignalType,
  DetectorResult,
} from './types'

// ─── Detector registry ──────────────────────────────────────────────────────
// Each detector is a function that compares current state against a baseline.
// In production these call Crustdata/Firecrawl; for testability we allow
// injection via `registerDetector`.

type DetectorFn = (
  watch: SignalWatch,
) => Promise<DetectorResult>

const detectors = new Map<SignalType, DetectorFn>()

export function registerDetector(type: SignalType, fn: DetectorFn): void {
  detectors.set(type, fn)
}

export function getDetector(type: SignalType): DetectorFn | undefined {
  return detectors.get(type)
}

// ─── Watch CRUD ─────────────────────────────────────────────────────────────

export async function addWatch(
  input: Omit<SignalWatch, 'id' | 'createdAt' | 'lastCheckedAt'>,
): Promise<SignalWatch> {
  const now = new Date().toISOString()
  const watch: SignalWatch = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    lastCheckedAt: now,
  }

  await db.insert(signalWatches).values({
    id: watch.id,
    tenantId: watch.tenantId,
    entityType: watch.entityType,
    entityId: watch.entityId,
    entityName: watch.entityName,
    signalTypes: JSON.stringify(watch.signalTypes),
    baseline: JSON.stringify(watch.baseline),
    createdAt: watch.createdAt,
    lastCheckedAt: watch.lastCheckedAt,
  })

  return watch
}

export async function listWatches(tenantId: string): Promise<SignalWatch[]> {
  const rows = await db
    .select()
    .from(signalWatches)
    .where(eq(signalWatches.tenantId, tenantId))

  return rows.map(deserializeWatch)
}

export async function removeWatch(id: string, tenantId: string): Promise<boolean> {
  const result = await db
    .delete(signalWatches)
    .where(and(eq(signalWatches.id, id), eq(signalWatches.tenantId, tenantId)))
  return (result as any).rowsAffected > 0
}

// ─── Signal Detection ───────────────────────────────────────────────────────

/**
 * Run detection for a single watch + signal type.
 * Returns a DetectedSignal if a change was found, null otherwise.
 * Deduplicates by {entityId, signalType, day}.
 */
export async function detectSignal(
  watch: SignalWatch,
  signalType: SignalType,
): Promise<DetectedSignal | null> {
  const detector = detectors.get(signalType)
  if (!detector) {
    console.warn(`[signals] No detector registered for "${signalType}"`)
    return null
  }

  // Run the detector
  const result = await detector(watch)

  if (!result.changed) return null

  // Dedup: check if we already have a signal for this entity+type today
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const existing = await db
    .select({ id: signalsLog.id })
    .from(signalsLog)
    .where(
      and(
        eq(signalsLog.tenantId, watch.tenantId),
        eq(signalsLog.type, signalType),
        eq(signalsLog.category, 'signal_detection'),
        sql`json_extract(${signalsLog.data}, '$.entityId') = ${watch.entityId}`,
        sql`substr(${signalsLog.createdAt}, 1, 10) = ${today}`,
      ),
    )
    .limit(1)

  if (existing.length > 0) {
    return null // Already recorded today
  }

  // Create the signal
  const signal: DetectedSignal = {
    id: randomUUID(),
    watchId: watch.id,
    signalType,
    entityId: watch.entityId,
    entityName: watch.entityName,
    summary: result.summary,
    data: result.data,
    detectedAt: new Date().toISOString(),
    tenantId: watch.tenantId,
  }

  // Log to signals_log
  await db.insert(signalsLog).values({
    id: signal.id,
    tenantId: signal.tenantId,
    type: signalType,
    category: 'signal_detection',
    data: JSON.stringify({
      entityId: signal.entityId,
      entityName: signal.entityName,
      watchId: signal.watchId,
      summary: signal.summary,
      ...signal.data,
    }),
    createdAt: signal.detectedAt,
  })

  // Update the watch baseline and lastCheckedAt
  await db
    .update(signalWatches)
    .set({
      baseline: JSON.stringify(result.newBaseline),
      lastCheckedAt: signal.detectedAt,
    })
    .where(eq(signalWatches.id, watch.id))

  // Feed intelligence store (always)
  const store = new IntelligenceStore(watch.tenantId)
  await store.add({
    category: 'qualification',
    insight: signal.summary,
    evidence: [
      {
        type: `signal_${signalType}`,
        sourceId: signal.id,
        metric: signalType,
        value: 1,
        sampleSize: 1,
        timestamp: signal.detectedAt,
      },
    ],
    segment: watch.entityType === 'company' ? watch.entityId : null,
    channel: null,
    confidence: 'hypothesis',
    source: 'external',
    biasCheck: null,
    supersedes: null,
    validatedAt: null,
    expiresAt: null,
  })

  // Execute configured triggers
  const triggerConfig = await loadTriggerConfig(watch.tenantId)
  if (triggerConfig) {
    await executeTriggers(signal, triggerConfig)
  }

  return signal
}

/**
 * Run all detectors for all watches matching the given filters.
 * Returns all detected signals.
 */
export async function runDetection(opts: {
  tenantId: string
  signalType?: SignalType
  entityId?: string
}): Promise<DetectedSignal[]> {
  const watches = await listWatches(opts.tenantId)
  const signals: DetectedSignal[] = []

  for (const watch of watches) {
    // Filter by entity if requested
    if (opts.entityId && watch.entityId !== opts.entityId) continue

    const typesToCheck = opts.signalType
      ? watch.signalTypes.filter(t => t === opts.signalType)
      : watch.signalTypes

    for (const type of typesToCheck) {
      try {
        const signal = await detectSignal(watch, type)
        if (signal) signals.push(signal)
      } catch (err) {
        console.error(
          `[signals] Detector "${type}" failed for ${watch.entityId}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  return signals
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deserializeWatch(row: any): SignalWatch {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    signalTypes: typeof row.signalTypes === 'string'
      ? JSON.parse(row.signalTypes)
      : row.signalTypes,
    baseline: typeof row.baseline === 'string'
      ? JSON.parse(row.baseline)
      : row.baseline ?? {},
    createdAt: row.createdAt,
    lastCheckedAt: row.lastCheckedAt,
    tenantId: row.tenantId,
  }
}
