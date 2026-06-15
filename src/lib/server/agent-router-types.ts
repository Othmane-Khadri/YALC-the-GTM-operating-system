/**
 * Unified Slack router contracts.
 *
 * Every demo agent (signal-to-call, buying-committee-mapper,
 * closed-won-lookalikes-watcher, slack-gtm-agent, lost-deal-revival-agent)
 * registers an IntentRouter + AgentHandler with the central dispatcher.
 *
 * The dispatcher matches inbound Slack messages to the first agent whose
 * router returns non-null, then invokes that agent's handler with a
 * streamer that posts status back into the same Slack thread.
 *
 * This file is the shared contract. Implementations live next to each
 * skill (`src/lib/skills/<id>/slack-adapter.ts`).
 */

import type { SlackInboundEvent } from './slack-input.js'

export type AgentId =
  | 'signal-to-call'
  | 'buying-committee-mapper'
  | 'closed-won-lookalikes-watcher'
  | 'slack-gtm-agent'
  | 'lost-deal-revival-agent'

/**
 * Each agent supplies an IntentRouter that inspects the inbound text and
 * returns a parsed payload if it claims the message, or null otherwise.
 * Routers are tried in registration order; first non-null wins.
 */
export type IntentRouter = (event: SlackInboundEvent) => RoutingMatch | null

export interface RoutingMatch {
  agentId: AgentId
  /** Parsed payload extracted from the message (URL, company name, etc.). */
  payload: Record<string, unknown>
}

/**
 * Once a router matches, the dispatcher invokes that agent's handler.
 * Handlers receive a Streamer that posts back to the originating thread,
 * and an awaitApproval bridge for human-in-the-loop gates.
 */
export type AgentHandler = (input: AgentHandlerInput) => Promise<AgentHandlerOutcome>

export interface AgentHandlerInput {
  /** Raw Slack event that triggered the run. */
  event: SlackInboundEvent
  /** Payload parsed by the IntentRouter. */
  payload: Record<string, unknown>
  /** Posts status, previews, and approval prompts back to Slack. */
  streamer: AgentStreamer
  /**
   * Session storage scoped to this thread. Use for multi-turn
   * conversations (e.g., asking the operator follow-up questions).
   */
  session: SessionStore
}

export interface AgentHandlerOutcome {
  state: 'completed' | 'aborted' | 'failed'
  /** Short summary safe for logging (no secrets). */
  summary?: string
  /** Optional links posted in the final message (CRM record, Notion page, Lemlist campaign, etc.). */
  links?: Array<{ label: string; url: string }>
  /** When state === 'failed', the error reason. */
  errorReason?: string
}

/**
 * Streamer posts updates back into the originating Slack thread.
 *
 * Implementations should be safe to call sequentially without coupling.
 * Each call writes a NEW message in the thread (we do not patch existing
 * Block Kit messages — Slack rewrites can lose ordering during fast runs).
 */
export interface AgentStreamer {
  /**
   * Post the initial "working on it" message. Sets the visual anchor for
   * subsequent updates. Called once per run, at the very start.
   */
  start(text: string): Promise<void>
  /**
   * Post a short progress update. Cheap to call; safe to call many times.
   */
  progress(text: string): Promise<void>
  /**
   * Post a Block Kit preview (the canonical "here's the dryrun, approve?"
   * surface). The blocks array is forwarded as `chat.postMessage(blocks)`.
   */
  preview(blocks: ReadonlyArray<Record<string, unknown>>): Promise<void>
  /**
   * Wait for the operator to approve via 👍 reaction OR a natural-language
   * reply ("looks good", "ship it", "approve", etc.). Approval must come
   * from the user who fired the run.
   */
  awaitApproval(
    runId: string,
    timeoutMs?: number
  ): Promise<ApprovalResolution>
  /**
   * Post the final success message + optional resource links.
   */
  done(text: string, links?: Array<{ label: string; url: string }>): Promise<void>
  /**
   * Post a clearly-marked error message.
   */
  error(text: string): Promise<void>
  /**
   * Ask the operator a follow-up question (multi-turn flow). Returns the
   * operator's reply text. Blocks until they reply or timeout.
   */
  ask(question: string, timeoutMs?: number): Promise<string | null>
}

export interface ApprovalResolution {
  state: 'approved' | 'rejected' | 'timeout'
  /** Slack user id of whoever resolved the gate (when state !== 'timeout'). */
  resolvedBy?: string
  /** ISO timestamp. */
  resolvedAt?: string
}

/**
 * Per-thread session storage. Used by Agent 2 (buying-committee-mapper)
 * to remember offer + first contact across multi-turn prompts.
 *
 * Implementations are scoped to one threadTs and survive within a single
 * dispatcher run. They do NOT persist across Slack listener restarts.
 */
export interface SessionStore {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  /** All keys currently in this session. */
  keys(): string[]
}

/**
 * Registration shape. Each agent exports one of these from its
 * `slack-adapter.ts` module. The dispatcher consumes the registry to
 * build the routing table.
 */
export interface SlackAgentRegistration {
  agentId: AgentId
  router: IntentRouter
  handler: AgentHandler
  /** Short human-facing description shown in the bot's "help" reply. */
  description: string
  /** Example trigger phrases shown in the "help" reply. */
  examples: ReadonlyArray<string>
}
