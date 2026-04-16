/**
 * Memory layer schema — Phase 1 / B1.
 *
 * Six tables backing the hybrid memory architecture (plan §2a):
 *   - memory_index       Always-loaded MEMORY.md-style pointer index (per tenant)
 *   - memory_nodes       Atomic memory units (facts, chunks, voice samples, etc.)
 *   - memory_embeddings  Dense vectors for semantic retrieval (BLOB)
 *   - entities           First-class entities (Person, Company, Segment, etc.)
 *   - memory_edges       Graph relations (node<->entity, node<->node)
 *   - memory_episodes    Episodic traces, later compressed into nodes
 *
 * All tables are tenant-scoped. Indexed separately from the main
 * `src/lib/db/schema.ts` so Phase 1 memory work can land without
 * touching the operational schema file (which is high-collision).
 */

import { sqliteTable, text, integer, real, blob, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// ─── memory_index ───────────────────────────────────────────────────────────
// The MEMORY.md equivalent: ~50-150 pointer rows per tenant, always loaded.
export const memoryIndex = sqliteTable(
  'memory_index',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull(),
    nodeIds: text('node_ids', { mode: 'json' }).notNull(),
    category: text('category').notNull(),
    priority: integer('priority').notNull().default(50),
    lastUpdated: text('last_updated').default(sql`(datetime('now'))`),
  },
  (t) => ({
    tenantIdx: index('memory_index_tenant_idx').on(t.tenantId),
  }),
)

// ─── memory_nodes ───────────────────────────────────────────────────────────
// Atomic memory units. One row per fact, chunk, voice sample, learning.
export const memoryNodes = sqliteTable(
  'memory_nodes',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    // fact | claim | observation | voice_sample | document_chunk |
    // interview_answer | learning | episode_summary
    type: text('type').notNull(),
    content: text('content').notNull(),
    // JSON array of entity refs (see Layer 4)
    entities: text('entities', { mode: 'json' }),
    // interview | website | upload | markdown-folder | campaign | conversation | adapter:*
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    sourceHash: text('source_hash').notNull(),
    // hypothesis | validated | proven
    confidence: text('confidence').notNull().default('hypothesis'),
    confidenceScore: integer('confidence_score').notNull().default(0),
    // Optional heading path / chunk metadata (JSON blob)
    metadata: text('metadata', { mode: 'json' }),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
    lastAccessedAt: text('last_accessed_at').default(sql`(datetime('now'))`),
    accessCount: integer('access_count').notNull().default(0),
    validatedAt: text('validated_at'),
    supersedes: text('supersedes'),
    archivedAt: text('archived_at'),
  },
  (t) => ({
    tenantIdx: index('memory_nodes_tenant_idx').on(t.tenantId),
    tenantTypeIdx: index('memory_nodes_tenant_type_idx').on(t.tenantId, t.type),
    tenantSourceHashIdx: index('memory_nodes_tenant_source_hash_idx').on(t.tenantId, t.sourceHash),
    tenantConfidenceIdx: index('memory_nodes_tenant_confidence_idx').on(t.tenantId, t.confidence),
  }),
)

// ─── memory_embeddings ──────────────────────────────────────────────────────
// Dense vectors per active node. One row per node; BLOB stores packed f32 array.
export const memoryEmbeddings = sqliteTable(
  'memory_embeddings',
  {
    nodeId: text('node_id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    embedding: blob('embedding').notNull(),
    model: text('model').notNull(),
    dims: integer('dims').notNull(),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
  },
  (t) => ({
    tenantIdx: index('memory_embeddings_tenant_idx').on(t.tenantId),
  }),
)

// ─── entities ───────────────────────────────────────────────────────────────
// Graph layer — first-class entities. Stable IDs survive renames/merges.
export const entities = sqliteTable(
  'entities',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    // Tenant | Segment | Channel | Campaign | Person | Company |
    // Provider | Skill | Playbook | Source
    type: text('type').notNull(),
    name: text('name').notNull(),
    aliases: text('aliases', { mode: 'json' }),
    properties: text('properties', { mode: 'json' }),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
  },
  (t) => ({
    tenantIdx: index('entities_tenant_idx').on(t.tenantId),
    tenantTypeNameIdx: index('entities_tenant_type_name_idx').on(t.tenantId, t.type, t.name),
  }),
)

// ─── memory_edges ───────────────────────────────────────────────────────────
// Typed relations — node<->entity, node<->node, entity<->entity.
export const memoryEdges = sqliteTable(
  'memory_edges',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    fromType: text('from_type').notNull(), // 'node' | 'entity'
    fromId: text('from_id').notNull(),
    toType: text('to_type').notNull(),     // 'node' | 'entity'
    toId: text('to_id').notNull(),
    // about | supports | contradicts | supersedes | derived_from |
    // mentioned_in | applies_to_segment | applies_to_channel | observed_in_campaign
    relation: text('relation').notNull(),
    weight: real('weight').notNull().default(1),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
  },
  (t) => ({
    tenantIdx: index('memory_edges_tenant_idx').on(t.tenantId),
    tenantFromIdx: index('memory_edges_tenant_from_idx').on(t.tenantId, t.fromType, t.fromId),
    tenantToIdx: index('memory_edges_tenant_to_idx').on(t.tenantId, t.toType, t.toId),
    tenantRelationIdx: index('memory_edges_tenant_relation_idx').on(t.tenantId, t.relation),
  }),
)

// ─── memory_episodes ────────────────────────────────────────────────────────
// Raw session/conversation traces; compressed into nodes by the dream pass.
export const memoryEpisodes = sqliteTable(
  'memory_episodes',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    tenantId: text('tenant_id').notNull(),
    // campaign_run | tracker_pass | onboarding_session | cli_session
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).notNull(),
    summarizedToNodeId: text('summarized_to_node_id'),
    createdAt: text('created_at').default(sql`(datetime('now'))`),
    archivedAt: text('archived_at'),
  },
  (t) => ({
    tenantIdx: index('memory_episodes_tenant_idx').on(t.tenantId),
    tenantKindIdx: index('memory_episodes_tenant_kind_idx').on(t.tenantId, t.kind),
  }),
)

export type MemoryNodeType =
  | 'fact'
  | 'claim'
  | 'observation'
  | 'voice_sample'
  | 'document_chunk'
  | 'interview_answer'
  | 'learning'
  | 'episode_summary'

export type MemoryConfidence = 'hypothesis' | 'validated' | 'proven'

export type EntityType =
  | 'Tenant'
  | 'Segment'
  | 'Channel'
  | 'Campaign'
  | 'Person'
  | 'Company'
  | 'Provider'
  | 'Skill'
  | 'Playbook'
  | 'Source'

export type EdgeRelation =
  | 'about'
  | 'supports'
  | 'contradicts'
  | 'supersedes'
  | 'derived_from'
  | 'mentioned_in'
  | 'applies_to_segment'
  | 'applies_to_channel'
  | 'observed_in_campaign'
