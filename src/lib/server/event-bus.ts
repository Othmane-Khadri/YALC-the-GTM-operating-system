/**
 * In-process event bus for SSE live updates (C5).
 *
 * The Hono /api/today/stream and /api/visualize/stream handlers subscribe
 * to this bus; the framework runner and the visualize runner publish to
 * it on every state transition or completion.
 *
 * Design goals:
 *   - Best-effort fan-out: a publish with no listeners is a fast no-op.
 *   - Process-local: no persistence across server restarts (v1 scope).
 *   - Stable event vocabulary so the wire format never silently drifts.
 *
 * Event vocabulary:
 *   today/*          — payload = today-feed item shape
 *     gate_awaiting    — runner paused at a human gate
 *     gate_approved    — operator approved an awaiting gate
 *     gate_rejected    — operator rejected an awaiting gate
 *     gate_stale       — gate crossed the 80% timeout threshold
 *     run_started      — runner began executing a framework
 *     run_completed    — run finished without error
 *     run_failed       — run aborted (or step threw)
 *
 *   visualize/*      — payload = /api/visualize/list per-item shape
 *     visualization_started     — runner began executing the visualize skill
 *     visualization_completed   — view written to disk
 *     visualization_failed      — visualize skill threw
 */

import { EventEmitter } from 'node:events'

export type TodayEventType =
  | 'gate_awaiting'
  | 'gate_approved'
  | 'gate_rejected'
  | 'gate_stale'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'

export type VisualizeEventType =
  | 'visualization_started'
  | 'visualization_completed'
  | 'visualization_failed'

export interface TodayEvent {
  type: TodayEventType
  /** Today-feed item shape — same as /api/today/feed item entries. */
  item: Record<string, unknown>
}

export interface VisualizeEvent {
  type: VisualizeEventType
  /** Visualization list item shape — same as /api/visualize/list items. */
  item: Record<string, unknown>
}

const TODAY_CHANNEL = 'today'
const VISUALIZE_CHANNEL = 'visualize'

/**
 * Singleton emitter shared across the process. The handlers in
 * routes/today.ts and routes/visualize.ts bind one listener per request;
 * the runners publish without caring whether anyone is listening.
 */
const emitter = new EventEmitter()
// Live subscriber sets are unbounded by design — disable the warning.
emitter.setMaxListeners(0)

/** Publish a /today event. No-op fast path when nothing is subscribed. */
export function publishTodayEvent(event: TodayEvent): void {
  if (emitter.listenerCount(TODAY_CHANNEL) === 0) return
  emitter.emit(TODAY_CHANNEL, event)
}

/** Publish a /visualize event. No-op fast path when nothing is subscribed. */
export function publishVisualizeEvent(event: VisualizeEvent): void {
  if (emitter.listenerCount(VISUALIZE_CHANNEL) === 0) return
  emitter.emit(VISUALIZE_CHANNEL, event)
}

/** Subscribe to /today events. Returns an unsubscribe function. */
export function subscribeTodayEvents(handler: (event: TodayEvent) => void): () => void {
  emitter.on(TODAY_CHANNEL, handler)
  return () => emitter.off(TODAY_CHANNEL, handler)
}

/** Subscribe to /visualize events. Returns an unsubscribe function. */
export function subscribeVisualizeEvents(
  handler: (event: VisualizeEvent) => void,
): () => void {
  emitter.on(VISUALIZE_CHANNEL, handler)
  return () => emitter.off(VISUALIZE_CHANNEL, handler)
}

/** Test helper — drop every listener on every channel. */
export function _resetEventBusForTests(): void {
  emitter.removeAllListeners()
}
