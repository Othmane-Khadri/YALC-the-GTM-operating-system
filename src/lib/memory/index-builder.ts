/**
 * Index builder — Phase 1 / B8.
 *
 * rebuildIndex(tenantId) asks Claude Sonnet to pick 50-150 of the most
 * load-bearing pointers from the tenant's proven/validated nodes and
 * writes them to the `memory_index` table via MemoryStore.replaceIndex.
 *
 * The resulting rows are the MEMORY.md-style hints that get injected
 * into every Claude prompt — they must be concise (descriptions are
 * one line each) and selective (50-150 max), because they sit in the
 * system prompt on every call.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client.js'
import { MemoryStore, type MemoryNodeRow } from './store.js'

const MIN_ENTRIES = 50
const MAX_ENTRIES = 150
const MAX_CANDIDATE_NODES = 400 // cap we send to Claude

const INDEX_CATEGORIES = [
  'company',
  'icp',
  'voice',
  'positioning',
  'channel',
  'playbook',
  'rule',
  'learning',
  'competitor',
  'other',
] as const

export type IndexCategory = (typeof INDEX_CATEGORIES)[number]

export interface IndexEntry {
  name: string
  description: string
  nodeIds: string[]
  category: IndexCategory
  priority?: number
}

const BUILD_INDEX_TOOL: Anthropic.Tool = {
  name: 'write_memory_index',
  description:
    'Write the tenant memory index as 50-150 pointer entries. Each entry is a single load-bearing concept (ICP, voice rule, playbook, company fact, competitor, learning) with a one-line description and the ids of the source nodes that back it. Do not inline raw content — the index is only pointers. Skip anything that does not materially change prompting decisions.',
  input_schema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        minItems: MIN_ENTRIES,
        maxItems: MAX_ENTRIES,
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Short label for the concept (e.g. "Voice: LinkedIn founders").',
            },
            description: {
              type: 'string',
              description: 'One-line description, max ~140 chars. No trailing period required.',
            },
            nodeIds: {
              type: 'array',
              items: { type: 'string' },
              description:
                'IDs of the source memory nodes this entry points to. Must be a subset of the node ids provided in the user message.',
            },
            category: {
              type: 'string',
              enum: INDEX_CATEGORIES as unknown as string[],
            },
            priority: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              description:
                'Relative importance 0-100. 90+ for identity/voice/rules, 60-89 for playbooks/ICP, <60 for learnings.',
            },
          },
          required: ['name', 'description', 'nodeIds', 'category'],
        },
      },
    },
    required: ['entries'],
  },
}

/**
 * Read the tenant's high-confidence nodes, ask Claude to distill them into
 * 50-150 pointer entries, and overwrite the tenant's memory_index.
 *
 * Returns the entries that were written. On failure (API error, malformed
 * tool call) throws — callers surface the error via withDiagnostics().
 */
export async function rebuildIndex(tenantId: string): Promise<IndexEntry[]> {
  const store = new MemoryStore(tenantId)

  // 1. Gather candidate nodes — proven/validated first, then recent hypotheses
  //    up to the MAX_CANDIDATE_NODES budget. We prefer load-bearing rows over
  //    random recency so the distillation stays signal-dense.
  const all = await store.listNodes({ limit: MAX_CANDIDATE_NODES })
  const sorted = [...all].sort((a, b) => confidenceRank(b) - confidenceRank(a))
  const candidates = sorted.slice(0, MAX_CANDIDATE_NODES)

  if (candidates.length === 0) {
    await store.replaceIndex([])
    return []
  }

  // 2. Build the user message — id + type + confidence + truncated content.
  const header = `You are building the memory index for tenant "${tenantId}". There are ${candidates.length} candidate memory nodes below. Pick 50-150 load-bearing concepts and write them via the write_memory_index tool. Prefer proven > validated > hypothesis when they conflict. Do not inline content — the index is pointers only.`

  const serialized = candidates
    .map((c) => formatNodeForPrompt(c))
    .join('\n\n---\n\n')

  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 8192,
    tools: [BUILD_INDEX_TOOL],
    tool_choice: { type: 'tool', name: 'write_memory_index' },
    messages: [
      {
        role: 'user',
        content: `${header}\n\n<nodes>\n${serialized}\n</nodes>`,
      },
    ],
  })

  // 3. Parse the tool call.
  let entries: IndexEntry[] = []
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'write_memory_index') {
      const input = block.input as { entries?: IndexEntry[] }
      entries = (input.entries ?? []).filter(
        (e) =>
          typeof e.name === 'string' &&
          typeof e.description === 'string' &&
          Array.isArray(e.nodeIds) &&
          e.nodeIds.length > 0,
      )
      break
    }
  }
  if (entries.length === 0) {
    throw new Error('rebuildIndex: Claude returned an empty or malformed index')
  }

  // 4. Drop any nodeId that isn't in the candidate set (guard against
  //    hallucinations — the model occasionally invents ids).
  const validIds = new Set(candidates.map((c) => c.id))
  const cleaned = entries
    .map((e) => ({ ...e, nodeIds: e.nodeIds.filter((id) => validIds.has(id)) }))
    .filter((e) => e.nodeIds.length > 0)

  // 5. Write the index.
  await store.replaceIndex(cleaned)
  return cleaned
}

function confidenceRank(n: MemoryNodeRow): number {
  if (n.confidence === 'proven') return 300 + n.confidenceScore
  if (n.confidence === 'validated') return 200 + n.confidenceScore
  return 100 + n.confidenceScore
}

function formatNodeForPrompt(n: MemoryNodeRow): string {
  const content = n.content.length > 400 ? `${n.content.slice(0, 400)}\u2026` : n.content
  return `id: ${n.id}\ntype: ${n.type}\nconfidence: ${n.confidence}\nsource: ${n.sourceType}\ncontent: ${content}`
}
