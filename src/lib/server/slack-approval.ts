/**
 * Slack approval store (S3).
 *
 * Backs pending human-in-the-loop approvals dispatched to Slack with rows in
 * the `slack_approvals` table. Resolution rules:
 *   - Only the original `requested_by` user can resolve.
 *   - Thumbs-up reaction (`+1` / `thumbsup`) approves.
 *   - Thumbs-down reaction (`-1` / `thumbsdown`) rejects.
 *   - Thread reply `/yalc approve <runId>` approves.
 *   - Thread reply `/yalc cancel <runId>` rejects.
 *   - Free-text thread replies are classified by an `IntentClassifier`
 *     (rule-based first, optional LLM fallback). Approve and reject verdicts
 *     resolve the row; an `unknown` verdict leaves the row pending.
 *   - `awaitApproval` polls every 500ms and falls through to `timeout` once
 *     `timeoutMs` elapses.
 *
 * The module exposes a small dependency-injection seam (`__setApprovalStore`)
 * so tests can run without a real SQLite handle. The classifier is injected
 * via `__setIntentClassifier` and defaults to the rule-based pass.
 */

import {
  makeRuleBasedClassifier,
  type ApprovalIntent,
  type IntentClassifier,
} from './approval-intent.js'

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'timeout'

export interface ApprovalRecord {
  id: string
  threadTs: string
  runId: string
  requestedBy: string
  channel: string
  state: ApprovalState
  createdAt: Date
  resolvedAt: Date | null
  resolvedBy: string | null
  nudgeSent: boolean
}

/**
 * Minimal Slack posting seam. Production wires this to Bolt's `WebClient`;
 * tests inject a spy. Default is a no-op so the store can be used in
 * environments (CLI tools, tests) without a Slack client.
 */
export interface SlackPoster {
  postReply: (threadTs: string, channel: string, text: string) => Promise<void>
}

const NOOP_POSTER: SlackPoster = {
  async postReply() {
    /* no-op */
  },
}

/**
 * The clarifying message the bot posts in-thread when the requester's reply
 * classifies as `unknown` intent. Plain ASCII only (no em/en dashes, no
 * hyphen-as-separator, no emoji) so it passes the outbound dash-scan rail.
 */
export const PENDING_NUDGE_TEXT =
  "Got it. Still waiting on a clear approve or reject before I ship. Reply 'go' or 'cancel' to finish."

export interface AwaitApprovalResult {
  state: ApprovalState
  resolvedBy?: string
  resolvedAt?: Date
}

export interface ApprovalStore {
  insert: (record: ApprovalRecord) => Promise<void>
  findByThreadTs: (threadTs: string) => Promise<ApprovalRecord | null>
  updateState: (
    threadTs: string,
    state: ApprovalState,
    resolvedBy: string | null,
    resolvedAt: Date | null,
  ) => Promise<ApprovalRecord | null>
  markNudgeSent: (threadTs: string) => Promise<ApprovalRecord | null>
}

const APPROVE_REPLY_RE = /^\s*\/yalc\s+approve(?:\s+(\S+))?\s*$/i
const CANCEL_REPLY_RE = /^\s*\/yalc\s+cancel(?:\s+(\S+))?\s*$/i

const APPROVE_REACTIONS = new Set(['+1', 'thumbsup', 'thumbs_up'])
const REJECT_REACTIONS = new Set(['-1', 'thumbsdown', 'thumbs_down'])

let store: ApprovalStore | null = null
let pollIntervalMs = 500
let intentClassifier: IntentClassifier = makeRuleBasedClassifier()
let slackPoster: SlackPoster = NOOP_POSTER

/** Set a custom store (used by tests and by the SQLite-backed adapter). */
export function __setApprovalStore(s: ApprovalStore | null): void {
  store = s
}

/** Override the polling interval (tests only). */
export function __setPollIntervalMs(ms: number): void {
  pollIntervalMs = ms
}

/**
 * Swap the intent classifier used by `resolveByReply` for free-text replies.
 * Production wires a chained rule + LLM classifier; tests inject mocks.
 * Pass `null` to reset to the rule-based default.
 */
export function __setIntentClassifier(c: IntentClassifier | null): void {
  intentClassifier = c ?? makeRuleBasedClassifier()
}

/**
 * Inject the Slack poster used to publish the in-thread "still pending"
 * nudge. Production wires Bolt's `WebClient.chat.postMessage`; tests inject
 * a spy. Pass `null` to reset to the no-op poster.
 */
export function __setSlackPoster(p: SlackPoster | null): void {
  slackPoster = p ?? NOOP_POSTER
}

function getStore(): ApprovalStore {
  if (store) return store
  throw new Error(
    '[slack-approval] No approval store configured. Call __setApprovalStore() first ' +
      '(production code should use createSqliteApprovalStore from this module).',
  )
}

/** Production-grade SQLite store. Imported lazily so tests don't need the DB. */
export async function createSqliteApprovalStore(): Promise<ApprovalStore> {
  const { db } = await import('../db/index.js')
  const { slackApprovals } = await import('../db/schema.js')
  const { eq } = await import('drizzle-orm')

  function rowToRecord(row: typeof slackApprovals.$inferSelect): ApprovalRecord {
    return {
      id: row.id,
      threadTs: row.threadTs,
      runId: row.runId,
      requestedBy: row.requestedBy,
      channel: row.channel,
      state: row.state as ApprovalState,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt as number),
      resolvedAt:
        row.resolvedAt === null || row.resolvedAt === undefined
          ? null
          : row.resolvedAt instanceof Date
            ? row.resolvedAt
            : new Date(row.resolvedAt as number),
      resolvedBy: row.resolvedBy ?? null,
      nudgeSent: Boolean(row.nudgeSent),
    }
  }

  return {
    async insert(record) {
      await db.insert(slackApprovals).values({
        id: record.id,
        threadTs: record.threadTs,
        runId: record.runId,
        requestedBy: record.requestedBy,
        channel: record.channel,
        state: record.state,
        createdAt: record.createdAt,
        resolvedAt: record.resolvedAt,
        resolvedBy: record.resolvedBy,
        nudgeSent: record.nudgeSent,
      })
    },
    async findByThreadTs(threadTs) {
      const rows = await db
        .select()
        .from(slackApprovals)
        .where(eq(slackApprovals.threadTs, threadTs))
        .limit(1)
      return rows[0] ? rowToRecord(rows[0]) : null
    },
    async updateState(threadTs, state, resolvedBy, resolvedAt) {
      await db
        .update(slackApprovals)
        .set({ state, resolvedBy, resolvedAt })
        .where(eq(slackApprovals.threadTs, threadTs))
      const rows = await db
        .select()
        .from(slackApprovals)
        .where(eq(slackApprovals.threadTs, threadTs))
        .limit(1)
      return rows[0] ? rowToRecord(rows[0]) : null
    },
    async markNudgeSent(threadTs) {
      await db
        .update(slackApprovals)
        .set({ nudgeSent: true })
        .where(eq(slackApprovals.threadTs, threadTs))
      const rows = await db
        .select()
        .from(slackApprovals)
        .where(eq(slackApprovals.threadTs, threadTs))
        .limit(1)
      return rows[0] ? rowToRecord(rows[0]) : null
    },
  }
}

/** Build an in-memory store. Useful for tests and dry-run flows. */
export function createMemoryApprovalStore(): ApprovalStore {
  const rows = new Map<string, ApprovalRecord>()
  return {
    async insert(record) {
      rows.set(record.threadTs, { ...record })
    },
    async findByThreadTs(threadTs) {
      const r = rows.get(threadTs)
      return r ? { ...r } : null
    },
    async updateState(threadTs, state, resolvedBy, resolvedAt) {
      const r = rows.get(threadTs)
      if (!r) return null
      r.state = state
      r.resolvedBy = resolvedBy
      r.resolvedAt = resolvedAt
      rows.set(threadTs, r)
      return { ...r }
    },
    async markNudgeSent(threadTs) {
      const r = rows.get(threadTs)
      if (!r) return null
      r.nudgeSent = true
      rows.set(threadTs, r)
      return { ...r }
    },
  }
}

/** Insert a pending approval row tied to a thread. */
export async function recordPending(
  threadTs: string,
  runId: string,
  requestedBy: string,
  channel: string,
): Promise<ApprovalRecord> {
  const record: ApprovalRecord = {
    id:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    threadTs,
    runId,
    requestedBy,
    channel,
    state: 'pending',
    createdAt: new Date(),
    resolvedAt: null,
    resolvedBy: null,
    nudgeSent: false,
  }
  await getStore().insert(record)
  return record
}

/**
 * Poll the approval row for `threadTs` until it transitions out of `pending`
 * or `timeoutMs` elapses. On timeout the row is updated to `timeout` so any
 * subsequent reaction or reply is treated as a no-op.
 *
 * `fromUserId` is the original requester; resolution is only honored from
 * this user. The argument is intentionally explicit (rather than re-reading
 * from the row) so callers can fail loudly when they pass the wrong user.
 */
export async function awaitApproval(
  threadTs: string,
  fromUserId: string,
  timeoutMs: number = 600_000,
): Promise<AwaitApprovalResult> {
  const s = getStore()
  const initial = await s.findByThreadTs(threadTs)
  if (!initial) {
    throw new Error(`[slack-approval] No pending row for thread ${threadTs}`)
  }
  if (initial.requestedBy !== fromUserId) {
    throw new Error(
      `[slack-approval] awaitApproval called for ${fromUserId} but row belongs to ${initial.requestedBy}`,
    )
  }
  if (initial.state !== 'pending') {
    return {
      state: initial.state,
      resolvedBy: initial.resolvedBy ?? undefined,
      resolvedAt: initial.resolvedAt ?? undefined,
    }
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise<void>((res) => setTimeout(res, pollIntervalMs))
    const row = await s.findByThreadTs(threadTs)
    if (!row) {
      throw new Error(`[slack-approval] Row for thread ${threadTs} vanished during await`)
    }
    if (row.state !== 'pending') {
      return {
        state: row.state,
        resolvedBy: row.resolvedBy ?? undefined,
        resolvedAt: row.resolvedAt ?? undefined,
      }
    }
  }

  const finalRow = await s.updateState(threadTs, 'timeout', null, new Date())
  return {
    state: 'timeout',
    resolvedAt: finalRow?.resolvedAt ?? undefined,
  }
}

/**
 * Resolve via a Slack reaction. Only honored when:
 *   - a pending row exists for `threadTs`
 *   - `byUserId` matches `requested_by`
 *   - reaction maps to approve or reject
 *
 * Returns the new state or null if the event was ignored.
 */
export async function resolveByReaction(
  threadTs: string,
  reactionName: string,
  byUserId: string,
): Promise<ApprovalState | null> {
  const s = getStore()
  const row = await s.findByThreadTs(threadTs)
  if (!row || row.state !== 'pending') return null
  if (row.requestedBy !== byUserId) return null

  let next: ApprovalState | null = null
  if (APPROVE_REACTIONS.has(reactionName)) next = 'approved'
  else if (REJECT_REACTIONS.has(reactionName)) next = 'rejected'
  if (!next) return null

  await s.updateState(threadTs, next, byUserId, new Date())
  return next
}

/**
 * Resolve via a thread reply. Three paths are supported, in order:
 *   1. Literal `/yalc approve <runId>` or `/yalc cancel <runId>`: the legacy
 *      fast path. If a run ID is supplied it must match the row's `run_id`.
 *   2. Free-text intent: the configured classifier maps the reply to
 *      approve, reject, or unknown. Approve/reject resolve the row; unknown
 *      leaves it pending.
 *
 * Original-sender-only is enforced before any classification work runs.
 */
export async function resolveByReply(
  threadTs: string,
  text: string,
  byUserId: string,
): Promise<ApprovalState | null> {
  const s = getStore()
  const row = await s.findByThreadTs(threadTs)
  if (!row || row.state !== 'pending') return null
  if (row.requestedBy !== byUserId) return null

  // ── 1. Legacy literal commands. Keep the run-ID guard intact. ──
  const approve = APPROVE_REPLY_RE.exec(text)
  const cancel = CANCEL_REPLY_RE.exec(text)
  if (approve || cancel) {
    const next: ApprovalState = approve ? 'approved' : 'rejected'
    const providedRunId = (approve ?? cancel)?.[1]
    if (providedRunId && providedRunId !== row.runId) return null
    await s.updateState(threadTs, next, byUserId, new Date())
    return next
  }

  // ── 2. Free-text intent. Unknown leaves the row pending. ──
  const verdict: ApprovalIntent = await intentClassifier.classify({
    text,
    runId: row.runId,
  })
  if (verdict === 'unknown') {
    // The original requester replied but their intent is ambiguous. Post one
    // clarifying nudge in-thread so they realise the gate is still open. We
    // never nudge twice for the same row (avoids spam on chatty threads) and
    // we never nudge a non-original-sender unknown reply (guarded above).
    if (!row.nudgeSent) {
      try {
        await slackPoster.postReply(threadTs, row.channel, PENDING_NUDGE_TEXT)
      } finally {
        // Mark the flag even if posting fails so a flaky network does not
        // turn into a nudge storm on every subsequent reply.
        await s.markNudgeSent(threadTs)
      }
    }
    return null
  }
  const next: ApprovalState = verdict === 'approve' ? 'approved' : 'rejected'
  await s.updateState(threadTs, next, byUserId, new Date())
  return next
}
