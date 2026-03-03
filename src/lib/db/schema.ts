import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { relations } from 'drizzle-orm'

// ─── Conversations ──────────────────────────────────────────────────────────
// Primary entity — every chat thread is a conversation
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull().default('New Conversation'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Messages ───────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  // text | workflow_proposal | table | knowledge_ref
  messageType: text('message_type').notNull().default('text'),
  // Stores WorkflowDefinition JSON when messageType = 'workflow_proposal'
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Workflows ──────────────────────────────────────────────────────────────
// Linked to the message that proposed/approved it
export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  messageId: text('message_id')
    .references(() => messages.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  // proposed | approved | running | completed | failed | paused
  status: text('status').notNull().default('proposed'),
  // Array of ProposedStep objects
  stepsDefinition: text('steps_definition', { mode: 'json' }),
  resultCount: integer('result_count').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

// ─── Workflow Steps ──────────────────────────────────────────────────────────
// Individual steps within a workflow execution
export const workflowSteps = sqliteTable('workflow_steps', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  // search | enrich | qualify | filter | export
  stepType: text('step_type').notNull(),
  // apollo | firecrawl | anthropic | builtwith | clay | manual
  provider: text('provider').notNull(),
  config: text('config', { mode: 'json' }),
  // pending | running | completed | failed | skipped
  status: text('status').notNull().default('pending'),
  result: text('result', { mode: 'json' }),
  rowsIn: integer('rows_in').default(0),
  rowsOut: integer('rows_out').default(0),
  costEstimate: real('cost_estimate'),
  errorMessage: text('error_message'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
})

// ─── Result Sets ─────────────────────────────────────────────────────────────
// Output tables — one per workflow (can have multiple per workflow eventually)
export const resultSets = sqliteTable('result_sets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  // Array of { key: string, label: string, type: 'text' | 'number' | 'url' | 'badge' }
  columnsDefinition: text('columns_definition', { mode: 'json' }),
  rowCount: integer('row_count').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Result Rows ─────────────────────────────────────────────────────────────
// Each row in a result table — feedback schema included from Day 1
export const resultRows = sqliteTable('result_rows', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  resultSetId: text('result_set_id')
    .notNull()
    .references(() => resultSets.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  // The actual row data as a JSON object
  data: text('data', { mode: 'json' }).notNull(),
  // RLHF feedback — approved | rejected | flagged | null
  feedback: text('feedback'),
  // Array of string tags
  tags: text('tags', { mode: 'json' }),
  annotation: text('annotation'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Knowledge Items ─────────────────────────────────────────────────────────
// Documents uploaded by the user — ICP, templates, competitive intel
export const knowledgeItems = sqliteTable('knowledge_items', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  // icp | template | competitive | learning | other
  type: text('type').notNull().default('other'),
  fileName: text('file_name').notNull(),
  // Extracted plain text — indexed by FTS5
  extractedText: text('extracted_text').notNull().default(''),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── API Connections ─────────────────────────────────────────────────────────
// Securely stored API keys — encrypted with AES-256-GCM
export const apiConnections = sqliteTable('api_connections', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  // apollo | anthropic | firecrawl | builtwith | clay | openai
  provider: text('provider').notNull().unique(),
  // AES-256-GCM encrypted: iv:authTag:ciphertext (base64 separated by colons)
  encryptedKey: text('encrypted_key').notNull(),
  // active | invalid | expired
  status: text('status').notNull().default('active'),
  lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Relations ───────────────────────────────────────────────────────────────
export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  workflows: many(workflows),
}))

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
}))

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [workflows.conversationId],
    references: [conversations.id],
  }),
  message: one(messages, {
    fields: [workflows.messageId],
    references: [messages.id],
  }),
  steps: many(workflowSteps),
  resultSets: many(resultSets),
}))

export const workflowStepsRelations = relations(workflowSteps, ({ one }) => ({
  workflow: one(workflows, {
    fields: [workflowSteps.workflowId],
    references: [workflows.id],
  }),
}))

export const resultSetsRelations = relations(resultSets, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [resultSets.workflowId],
    references: [workflows.id],
  }),
  rows: many(resultRows),
}))

export const resultRowsRelations = relations(resultRows, ({ one }) => ({
  resultSet: one(resultSets, {
    fields: [resultRows.resultSetId],
    references: [resultSets.id],
  }),
}))
