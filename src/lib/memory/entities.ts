/**
 * Entity extraction — Phase 1 / B5.
 *
 * Uses Claude Sonnet with a forced `extract_entities` tool to pull
 * first-class entities from arbitrary text. Results are resolved
 * through MemoryStore.upsertEntity so alias matching and dedup
 * happen in the tenant's canonical graph.
 *
 * Schema matches memory/schema.ts → entities.type enum exactly.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, PLANNER_MODEL } from '../ai/client.js'
import type { MemoryStore } from './store.js'
import type { EntityType } from './schema.js'

export interface ExtractedEntity {
  type: EntityType
  name: string
  aliases?: string[]
}

export interface ExtractEntitiesResult {
  extracted: ExtractedEntity[]
  resolved: Array<{ entity: ExtractedEntity; id: string; inserted: boolean }>
}

const ENTITY_TYPES: EntityType[] = [
  'Tenant',
  'Segment',
  'Channel',
  'Campaign',
  'Person',
  'Company',
  'Provider',
  'Skill',
  'Playbook',
  'Source',
]

const EXTRACT_ENTITIES_TOOL: Anthropic.Tool = {
  name: 'extract_entities',
  description:
    'Extract first-class entities mentioned in the provided text. Only extract entities that are concrete, named, and directly referenced — skip generic nouns. Prefer canonical names over variants and populate aliases when the text uses multiple forms.',
  input_schema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        description: 'Entities found in the text. Empty array if none.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ENTITY_TYPES as unknown as string[],
              description:
                'Entity type. Segment = an ICP/audience slice. Channel = outreach channel (LinkedIn/email/Reddit). Playbook = a named GTM playbook. Skill = a GTM capability like qualify/enrich. Provider = a data or outreach vendor.',
            },
            name: {
              type: 'string',
              description: 'Canonical name of the entity.',
            },
            aliases: {
              type: 'array',
              items: { type: 'string' },
              description: 'Alternate spellings or surface forms seen in the text.',
            },
          },
          required: ['type', 'name'],
        },
      },
    },
    required: ['entities'],
  },
}

/**
 * Call Claude to extract entities from `text`. Does NOT touch the store.
 * Used standalone by the index builder and dream passes.
 */
export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  if (!text.trim()) return []

  const client = getAnthropicClient()
  const res = await client.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 1024,
    tools: [EXTRACT_ENTITIES_TOOL],
    tool_choice: { type: 'tool', name: 'extract_entities' },
    messages: [
      {
        role: 'user',
        content: `Extract named entities from the following text. Use the extract_entities tool.\n\n<text>\n${text}\n</text>`,
      },
    ],
  })

  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === 'extract_entities') {
      const input = block.input as { entities?: ExtractedEntity[] }
      const raw = input.entities ?? []
      // Defensive: filter any bad type values the model may emit.
      return raw.filter((e) => ENTITY_TYPES.includes(e.type) && typeof e.name === 'string')
    }
  }

  return []
}

/**
 * Extract entities and resolve them against the tenant's canonical graph
 * via MemoryStore.upsertEntity (handles alias dedup and merges).
 */
export async function extractAndResolveEntities(
  store: MemoryStore,
  text: string,
): Promise<ExtractEntitiesResult> {
  const extracted = await extractEntities(text)
  const resolved: ExtractEntitiesResult['resolved'] = []
  for (const entity of extracted) {
    const r = await store.upsertEntity({
      type: entity.type,
      name: entity.name,
      aliases: entity.aliases,
    })
    resolved.push({ entity, id: r.id, inserted: r.inserted })
  }
  return { extracted, resolved }
}
