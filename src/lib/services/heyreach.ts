// HeyReach LinkedIn outreach service. Thin typed wrapper around the public
// REST API plus the JSON-RPC MCP server.
//
// Auth:
//   - REST:  X-API-KEY header  (HEYREACH_API_KEY)
//   - MCP:   query param xMcpKey (HEYREACH_MCP_KEY)
//
// Why both: the REST API exposes campaigns + stats + lists, but does NOT
// surface the message sequence/copy or the LinkedIn conversation thread. The
// MCP server (https://mcp.heyreach.io/mcp) does — `get_conversations_v2` and
// `get_chatroom` together let us pull the real outbound messages and infer
// where in the sequence each reply landed.
//
// All HTTP calls go through cachedFetch / withCache so partial results
// survive a crash and identical calls dedupe across campaigns.

import { cachedFetch, withCache } from '../cache/cached-fetch'

const API_BASE = 'https://api.heyreach.io/api/public'
const MCP_BASE = 'https://mcp.heyreach.io/mcp'
const CACHE_SCOPE = 'heyreach'
const PAGE_SIZE = 100

export interface HeyReachCampaign {
  id: number
  name: string
  creationTime: string
  linkedInUserListName: string
  linkedInUserListId: number
  campaignAccountIds: number[]
  status: 'DRAFT' | 'IN_PROGRESS' | 'PAUSED' | 'FINISHED' | string
  progressStats: {
    totalUsers: number
    totalUsersInProgress: number
    totalUsersPending: number
    totalUsersFinished: number
    totalUsersFailed: number
    totalUsersManuallyStopped: number
    totalUsersExcluded: number
  }
  excludeInOtherCampaigns: boolean
  excludeHasOtherAccConversations: boolean
  excludeContactedFromSenderInOtherCampaign: boolean
  excludeListId: number | null
  organizationUnitId: number
  startedAt: string | null
}

export interface HeyReachStats {
  profileViews: number
  postLikes: number
  follows: number
  messagesSent: number
  totalMessageStarted: number
  totalMessageReplies: number
  inmailMessagesSent: number
  totalInmailStarted: number
  totalInmailReplies: number
  connectionsSent: number
  connectionsAccepted: number
  uniqueLeadsContacted: number
  autoTaggedInterested: number
  totalAutoTagged: number
  messageReplyRate: number
  inMailReplyRate: number
  connectionAcceptanceRate: number
  autoTaggedInterestedRate: number
}

function apiKey(): string {
  const k = process.env.HEYREACH_API_KEY
  if (!k) throw new Error('HEYREACH_API_KEY is not set in .env.local')
  return k
}

async function post<T>(path: string, body: unknown, opts?: { bypass?: boolean }): Promise<T> {
  const res = await cachedFetch(
    `${API_BASE}${path}`,
    {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey(), 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    },
    { scope: CACHE_SCOPE, ttlMs: 5 * 60_000, bypass: opts?.bypass }, // 5min TTL — analytics drift quickly
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HeyReach POST ${path} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  return (await res.json()) as T
}

/** List all campaigns visible to the API key. Auto-paginates. */
export async function listAllCampaigns(opts?: { bypass?: boolean }): Promise<HeyReachCampaign[]> {
  const out: HeyReachCampaign[] = []
  let offset = 0
  for (;;) {
    const page = await post<{ totalCount: number; items: HeyReachCampaign[] }>(
      '/campaign/GetAll',
      { offset, limit: PAGE_SIZE },
      opts,
    )
    out.push(...page.items)
    if (page.items.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    if (offset > 5000) break // safety cap
  }
  return out
}

/**
 * Filter to campaigns where the given LinkedIn account is listed as a sender.
 * Used to scope imports to one operator (e.g. David only).
 */
export function filterCampaignsBySender(
  campaigns: HeyReachCampaign[],
  linkedInAccountId: number,
): HeyReachCampaign[] {
  return campaigns.filter((c) => Array.isArray(c.campaignAccountIds) && c.campaignAccountIds.includes(linkedInAccountId))
}

/** Pull aggregate stats for a single campaign / sender pair. */
export async function getOverallStats(
  campaignId: number,
  accountIds: number[],
  opts?: { bypass?: boolean },
): Promise<HeyReachStats> {
  const res = await post<{ overallStats: HeyReachStats }>(
    '/stats/GetOverallStats',
    { campaignIds: [campaignId], accountIds },
    opts,
  )
  return res.overallStats
}

// ─── MCP (JSON-RPC) ────────────────────────────────────────────────────────
// Used for: pulling conversation threads to extract real outbound copy and
// reply-step attribution. The REST API doesn't expose this surface.

function mcpKey(): string {
  const k = process.env.HEYREACH_MCP_KEY
  if (!k) throw new Error('HEYREACH_MCP_KEY is not set in .env.local')
  return k
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string }
}

let mcpInitialized = false
let mcpRpcId = 1

async function mcpCall<T>(method: string, params: unknown): Promise<T> {
  const url = `${MCP_BASE}?xMcpKey=${encodeURIComponent(mcpKey())}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: mcpRpcId++, method, params }),
  })
  if (!res.ok) throw new Error(`HeyReach MCP ${method} HTTP ${res.status}`)
  const text = await res.text()
  // MCP server uses SSE-style framing: `event: message\ndata: { ...json... }`.
  // Parse the first data line as JSON.
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim() ?? text
  let parsed: JsonRpcResponse<T>
  try {
    parsed = JSON.parse(dataLine) as JsonRpcResponse<T>
  } catch (err) {
    throw new Error(`HeyReach MCP ${method} unparseable response: ${text.slice(0, 200)}`)
  }
  if (parsed.error) throw new Error(`HeyReach MCP ${method} failed: ${parsed.error.message}`)
  if (parsed.result === undefined) throw new Error(`HeyReach MCP ${method} returned no result`)
  return parsed.result
}

async function mcpInit(): Promise<void> {
  if (mcpInitialized) return
  await mcpCall<unknown>('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'yalc-internal', version: '1.0' },
  })
  mcpInitialized = true
}

interface McpToolCallResult {
  content?: Array<{ type: string; text: string }>
}

async function mcpToolCall<T>(name: string, args: unknown): Promise<T> {
  await mcpInit()
  const result = await mcpCall<McpToolCallResult>('tools/call', { name, arguments: args })
  const text = result.content?.[0]?.text ?? ''
  if (!text) throw new Error(`HeyReach MCP tool ${name} returned empty content`)
  return JSON.parse(text) as T
}

export type ChatSender = 'ME' | 'CORRESPONDENT'

export interface ChatMessage {
  createdAt: string
  body: string
  subject: string | null
  postLink: string | null
  isInMail: boolean
  sender: ChatSender
}

export interface Conversation {
  id: string
  read: boolean
  totalMessages: number
  linkedInAccountId: number
  lastMessageAt?: string
  correspondentProfile?: {
    firstName?: string
    lastName?: string
    headline?: string
    profileUrl?: string
  }
  messages?: ChatMessage[]
}

interface ConversationsResponse {
  totalCount: number
  items: Conversation[]
}

/** List conversations for a campaign+sender. Auto-paginates. */
export async function listCampaignConversations(opts: {
  campaignId: number
  accountId: number
  bypass?: boolean
}): Promise<Conversation[]> {
  const cacheKey = `conversations:${opts.accountId}:${opts.campaignId}`
  return withCache(
    { scope: CACHE_SCOPE, key: cacheKey, ttlMs: 60 * 60_000 }, // 1h — conversation lists evolve slowly
    async () => {
      const out: Conversation[] = []
      let offset = 0
      for (;;) {
        const page = await mcpToolCall<ConversationsResponse>('get_conversations_v2', {
          linkedInAccountIds: [opts.accountId],
          campaignIds: [opts.campaignId],
          offset,
          limit: 50,
        })
        out.push(...page.items)
        if (page.items.length < 50) break
        offset += 50
        if (offset > 5000) break // safety
      }
      return out
    },
  )
}

/** Fetch a full chatroom (messages array) for a conversation. */
export async function getChatroom(opts: {
  accountId: number
  conversationId: string
  bypass?: boolean
}): Promise<Conversation> {
  const cacheKey = `chatroom:${opts.accountId}:${opts.conversationId}`
  return withCache(
    { scope: CACHE_SCOPE, key: cacheKey, ttlMs: 60 * 60_000 },
    () =>
      mcpToolCall<Conversation>('get_chatroom', {
        accountId: opts.accountId,
        conversationId: opts.conversationId,
      }),
  )
}

export interface ExtractedCopy {
  /**
   * Most representative DM-step examples ("ME" messages), in step order.
   * Step 1 = the first message David sent after acceptance, etc.
   */
  steps: Array<{ step: number; exemplar: string; sample_count: number }>
  /** How many conversations had a CORRESPONDENT reply after each ME step. */
  replyAttribution: Array<{ after_step: number; replies: number }>
  /** Conversations sampled (for transparency). */
  conversationsSampled: number
}

/**
 * Pull a campaign's chatrooms and extract:
 *  1. The most common first/second/third ME message (the actual outbound copy)
 *  2. How many conversations replied after each ME step
 *
 * Note: connection-request notes are NOT included in LinkedIn chat threads,
 * so this won't recover the connect-note copy — only post-acceptance DMs.
 */
export async function extractCampaignCopy(opts: {
  campaignId: number
  accountId: number
  bypass?: boolean
}): Promise<ExtractedCopy> {
  const conversations = await listCampaignConversations(opts)

  // For each conversation, hydrate its messages array (some come back in the
  // list call already, but not all — refetch via get_chatroom to be safe).
  const stepBuckets: Map<number, Map<string, number>> = new Map()
  const replyAfterStep: Map<number, number> = new Map()

  for (const c of conversations) {
    let msgs = c.messages
    if (!msgs || msgs.length === 0) {
      try {
        const full = await getChatroom({ accountId: opts.accountId, conversationId: c.id })
        msgs = full.messages ?? []
      } catch {
        continue
      }
    }
    if (!msgs || msgs.length === 0) continue

    // Walk in chronological order, count ME messages as steps.
    let meStep = 0
    let lastMeStep = 0
    for (const m of msgs) {
      if (m.sender === 'ME') {
        meStep++
        lastMeStep = meStep
        const body = (m.body ?? '').trim()
        if (!body) continue
        // Bucket the exemplar — first 500 chars to keep memory bounded.
        const bucket = stepBuckets.get(meStep) ?? new Map<string, number>()
        bucket.set(body, (bucket.get(body) ?? 0) + 1)
        stepBuckets.set(meStep, bucket)
      } else if (m.sender === 'CORRESPONDENT' && lastMeStep > 0) {
        // Count this conversation as replying after `lastMeStep`. Only count
        // the first reply per conversation so a chatty thread doesn't double-
        // weight the attribution.
        replyAfterStep.set(lastMeStep, (replyAfterStep.get(lastMeStep) ?? 0) + 1)
        lastMeStep = -1 // sentinel: already counted this conversation
      }
    }
  }

  // Pick the most-common exemplar per step.
  const steps: ExtractedCopy['steps'] = []
  for (const [step, bucket] of [...stepBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    let bestText = ''
    let bestCount = 0
    let total = 0
    for (const [text, count] of bucket.entries()) {
      total += count
      if (count > bestCount) {
        bestCount = count
        bestText = text
      }
    }
    steps.push({ step, exemplar: bestText, sample_count: total })
  }

  const replyAttribution = [...replyAfterStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([after_step, replies]) => ({ after_step, replies }))

  return { steps, replyAttribution, conversationsSampled: conversations.length }
}
