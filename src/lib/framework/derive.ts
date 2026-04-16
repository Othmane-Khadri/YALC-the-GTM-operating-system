/**
 * Derive framework from memory — Phase 1 / C5.
 *
 * deriveFramework(tenantId) is the replacement for the legacy hand-edited
 * gtm-os.yaml. It reads the tenant's top proven/validated memory nodes
 * plus all interview_answer rows, asks Claude Sonnet to synthesize a
 * partial GTMFramework via a tool call, merges that with the template,
 * and writes the result to both the DB (`frameworks` table, scoped by
 * tenantId) and the per-tenant YAML at
 * `~/.gtm-os/tenants/<slug>/framework.yaml`.
 *
 * The derived framework is a *view* over memory \u2014 safe to regenerate
 * any time. It carries `onboardingComplete: true` when there is any
 * interview or memory content to work with.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client.js'
import { MemoryStore } from '../memory/store.js'
import { saveFramework } from './context.js'
import { createEmptyFramework } from './template.js'
import type { GTMFramework } from './types.js'

const MAX_CANDIDATE_NODES = 200
const MAX_CONTENT_CHARS = 600

const DERIVE_FRAMEWORK_TOOL: Anthropic.Tool = {
  name: 'write_framework',
  description:
    'Write a partial GTMFramework derived from the tenant memory nodes provided. Only populate fields you have high-confidence evidence for \u2014 omit or leave empty anything speculative. Segments should reflect only clearly identified ICPs. The output is merged on top of an empty template, so array fields you omit stay empty.',
  input_schema: {
    type: 'object',
    properties: {
      company: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          website: { type: 'string' },
          industry: { type: 'string' },
          description: { type: 'string' },
          stage: {
            type: 'string',
            enum: ['pre-seed', 'seed', 'series-a', 'series-b', 'growth', 'enterprise'],
          },
          teamSize: { type: 'string' },
        },
      },
      positioning: {
        type: 'object',
        properties: {
          valueProp: { type: 'string' },
          category: { type: 'string' },
          differentiators: { type: 'array', items: { type: 'string' } },
          proofPoints: { type: 'array', items: { type: 'string' } },
          competitors: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                website: { type: 'string' },
                positioning: { type: 'string' },
              },
              required: ['name'],
            },
          },
        },
      },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            priority: {
              type: 'string',
              enum: ['primary', 'secondary', 'exploratory'],
            },
            targetRoles: { type: 'array', items: { type: 'string' } },
            targetCompanySizes: { type: 'array', items: { type: 'string' } },
            targetIndustries: { type: 'array', items: { type: 'string' } },
            painPoints: { type: 'array', items: { type: 'string' } },
            disqualifiers: { type: 'array', items: { type: 'string' } },
            voice: {
              type: 'object',
              properties: {
                tone: { type: 'string' },
                style: { type: 'string' },
                keyPhrases: { type: 'array', items: { type: 'string' } },
                avoidPhrases: { type: 'array', items: { type: 'string' } },
              },
            },
            messaging: {
              type: 'object',
              properties: {
                elevatorPitch: { type: 'string' },
                keyMessages: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['id', 'name', 'priority'],
        },
      },
      channels: {
        type: 'object',
        properties: {
          active: { type: 'array', items: { type: 'string' } },
        },
      },
      signals: {
        type: 'object',
        properties: {
          buyingIntentSignals: { type: 'array', items: { type: 'string' } },
          triggerEvents: { type: 'array', items: { type: 'string' } },
          monitoringKeywords: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}

export interface DeriveFrameworkResult {
  framework: GTMFramework
  nodesConsidered: number
  interviewAnswersUsed: number
}

export async function deriveFramework(tenantId: string): Promise<DeriveFrameworkResult> {
  const store = new MemoryStore(tenantId)

  // 1. Collect candidates: all interview_answer rows, plus top proven/validated
  //    nodes up to the budget.
  const interviewAnswers = await store.listNodes({ type: 'interview_answer', limit: 100 })
  const topNodes = await store.listNodes({ limit: MAX_CANDIDATE_NODES })
  const byId = new Map(interviewAnswers.concat(topNodes).map((n) => [n.id, n]))
  const candidates = Array.from(byId.values())

  if (candidates.length === 0) {
    // Empty tenant \u2014 write the blank template with onboardingComplete=false.
    const fw = createEmptyFramework()
    fw.onboardingComplete = false
    await saveFramework(fw, tenantId)
    return { framework: fw, nodesConsidered: 0, interviewAnswersUsed: 0 }
  }

  // 2. Serialize for Claude.
  const sorted = candidates.sort((a, b) => {
    // interview answers first, then proven/validated, then by score
    if (a.type !== b.type) {
      if (a.type === 'interview_answer') return -1
      if (b.type === 'interview_answer') return 1
    }
    const rc = rank(b.confidence) - rank(a.confidence)
    if (rc !== 0) return rc
    return b.confidenceScore - a.confidenceScore
  })
  const serialized = sorted
    .slice(0, MAX_CANDIDATE_NODES)
    .map((n) => serializeNode(n))
    .join('\n\n---\n\n')

  // 3. Claude call.
  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 8192,
    tools: [DERIVE_FRAMEWORK_TOOL],
    tool_choice: { type: 'tool', name: 'write_framework' },
    messages: [
      {
        role: 'user',
        content: `Derive a GTMFramework for tenant "${tenantId}" from the memory nodes below. Use the write_framework tool. Only populate fields you have strong evidence for.\n\n<nodes>\n${serialized}\n</nodes>`,
      },
    ],
  })

  let partial: Partial<GTMFramework> = {}
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'write_framework') {
      partial = block.input as Partial<GTMFramework>
      break
    }
  }

  // 4. Merge on top of an empty template so we never miss required fields.
  const base = createEmptyFramework()
  const merged: GTMFramework = mergeFramework(base, partial)
  merged.onboardingComplete = true
  merged.lastUpdated = new Date().toISOString()
  merged.version = (base.version ?? 0) + 1

  // 5. Persist.
  await saveFramework(merged, tenantId)

  return {
    framework: merged,
    nodesConsidered: candidates.length,
    interviewAnswersUsed: interviewAnswers.length,
  }
}

function rank(c: string): number {
  if (c === 'proven') return 3
  if (c === 'validated') return 2
  return 1
}

function serializeNode(n: { id: string; type: string; content: string; confidence: string }): string {
  const content =
    n.content.length > MAX_CONTENT_CHARS ? `${n.content.slice(0, MAX_CONTENT_CHARS)}\u2026` : n.content
  return `id: ${n.id}\ntype: ${n.type}\nconfidence: ${n.confidence}\ncontent: ${content}`
}

function mergeFramework(base: GTMFramework, partial: Partial<GTMFramework>): GTMFramework {
  return {
    ...base,
    company: { ...base.company, ...(partial.company ?? {}) },
    positioning: {
      ...base.positioning,
      ...(partial.positioning ?? {}),
      differentiators:
        partial.positioning?.differentiators ?? base.positioning.differentiators,
      proofPoints: partial.positioning?.proofPoints ?? base.positioning.proofPoints,
      competitors: (partial.positioning?.competitors as any) ?? base.positioning.competitors,
    },
    segments: (partial.segments as any) ?? base.segments,
    channels: {
      ...base.channels,
      ...(partial.channels ?? {}),
    },
    signals: {
      ...base.signals,
      ...(partial.signals ?? {}),
    },
  }
}
