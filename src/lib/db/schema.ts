import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import { relations, sql } from 'drizzle-orm'

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
  tenantId: text('tenant_id').notNull().default('default'),
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

// ─── Frameworks ─────────────────────────────────────────────────────────────
// GTM Framework — the living intelligence layer. One per user.
export const frameworks = sqliteTable('frameworks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text('tenant_id').notNull().default('default'),
  userId: text('user_id').notNull().default('default'),
  data: text('data', { mode: 'json' }).notNull(),
  onboardingStep: integer('onboarding_step').default(0),
  onboardingComplete: integer('onboarding_complete', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .$defaultFn(() => new Date()),
})

// ─── Intelligence ──────────────────────────────────────────────────────────
// Structured intelligence entries — evidence-backed, bias-checked, confidence-scored
export const intelligence = sqliteTable('intelligence', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  category: text('category').notNull(),
  insight: text('insight').notNull(),
  evidence: text('evidence').notNull(), // JSON: Evidence[]
  segment: text('segment'),
  channel: text('channel'),
  confidence: text('confidence').notNull().default('hypothesis'),
  confidenceScore: integer('confidence_score').default(0),
  source: text('source').notNull(),
  biasCheck: text('bias_check'), // JSON: BiasCheck | null
  supersedes: text('supersedes'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  validatedAt: text('validated_at'),
  expiresAt: text('expires_at'),
})

// ─── MCP Servers ────────────────────────────────────────────────────────────
// MCP server configurations and connection state
export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  transport: text('transport').notNull(), // 'stdio' | 'sse'
  command: text('command'),
  args: text('args'), // JSON string
  url: text('url'),
  env: text('env'), // encrypted JSON string
  status: text('status').default('disconnected'),
  lastConnectedAt: text('last_connected_at'),
  discoveredTools: text('discovered_tools'), // JSON string
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Review Queue ──────────────────────────────────────────────────────────
// Unified human-in-the-loop review queue
export const reviewQueue = sqliteTable('review_queue', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  sourceSystem: text('source_system').notNull(),
  sourceId: text('source_id').notNull(),
  priority: text('priority').notNull().default('normal'),
  status: text('status').notNull().default('pending'),
  payload: text('payload').notNull(), // JSON
  action: text('action'), // JSON
  nudgeEvidence: text('nudge_evidence'), // JSON
  reviewedAt: text('reviewed_at'),
  reviewNotes: text('review_notes'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Notification Preferences ──────────────────────────────────────────────
export const notificationPreferences = sqliteTable('notification_preferences', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  config: text('config').notNull(), // JSON
  minPriority: text('min_priority').notNull().default('normal'),
  enabled: integer('enabled').notNull().default(1),
})

// ─── Web Cache ────────────────────────────────────────────────────────────
// Cached web pages with TTL per content type
export const webCache = sqliteTable('web_cache', {
  id: text('id').primaryKey(),
  url: text('url').notNull().unique(),
  content: text('content').notNull(),
  contentType: text('content_type').notNull(),
  extractedInsights: text('extracted_insights'),
  fetchedAt: text('fetched_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})

// ─── Web Research Tasks ──────────────────────────────────────────────────
export const webResearchTasks = sqliteTable('web_research_tasks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  targetType: text('target_type').notNull(),
  targetIdentifier: text('target_identifier').notNull(),
  status: text('status').notNull().default('pending'),
  results: text('results'),
  requestedBy: text('requested_by').notNull(),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  completedAt: text('completed_at'),
})

// ─── Campaigns ──────────────────────────────────────────────────────────────
export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  hypothesis: text('hypothesis').notNull(),
  status: text('status').notNull().default('draft'),
  targetSegment: text('target_segment'),
  channels: text('channels').notNull(),
  successMetrics: text('success_metrics').notNull(),
  metrics: text('metrics').notNull(),
  verdict: text('verdict'),
  // LinkedIn campaign extensions
  linkedinAccountId: text('linkedin_account_id'),
  dailyLimit: integer('daily_limit').default(30),
  sequenceTiming: text('sequence_timing', { mode: 'json' }), // { connect_to_dm1_days, dm1_to_dm2_days }
  experimentStatus: text('experiment_status'), // testing | winner_declared | inconclusive
  winnerVariant: text('winner_variant'),
  notionPageId: text('notion_page_id'), // for Notion sync
  // Scheduling config — JSON blob: { timezone, startAt, sendWindow, activeDays, sendingPace, delayMode }
  schedule: text('schedule', { mode: 'json' }),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// ─── Campaign Steps ─────────────────────────────────────────────────────────
export const campaignSteps = sqliteTable('campaign_steps', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stepIndex: integer('step_index').notNull(),
  skillId: text('skill_id').notNull(),
  skillInput: text('skill_input').notNull(),
  channel: text('channel'),
  status: text('status').notNull().default('pending'),
  dependsOn: text('depends_on').notNull().default('[]'),
  approvalRequired: integer('approval_required').notNull().default(1),
  resultSetId: text('result_set_id'),
  scheduledAt: text('scheduled_at'),
  completedAt: text('completed_at'),
})

// ─── Campaign Content ───────────────────────────────────────────────────────
export const campaignContent = sqliteTable('campaign_content', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull().references(() => campaignSteps.id, { onDelete: 'cascade' }),
  contentType: text('content_type').notNull(),
  targetLeadId: text('target_lead_id'),
  content: text('content').notNull(),
  variant: text('variant'),
  status: text('status').notNull().default('draft'),
  personalizationData: text('personalization_data').notNull(),
  sentAt: text('sent_at'),
  openedAt: text('opened_at'),
  clickedAt: text('clicked_at'),
  repliedAt: text('replied_at'),
  convertedAt: text('converted_at'),
  bouncedAt: text('bounced_at'),
})

// ─── Campaign Variants ─────────────────────────────────────────────────────
// One row per messaging angle/variant for A/B testing
export const campaignVariants = sqliteTable('campaign_variants', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text('tenant_id').notNull().default('default'),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'), // active | winner | retired
  connectNote: text('connect_note').notNull(),
  dm1Template: text('dm1_template').notNull(),
  dm2Template: text('dm2_template').notNull(),
  sends: integer('sends').default(0),
  accepts: integer('accepts').default(0),
  acceptRate: real('accept_rate').default(0),
  dmsSent: integer('dms_sent').default(0),
  replies: integer('replies').default(0),
  replyRate: real('reply_rate').default(0),
  notionPageId: text('notion_page_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Campaign Leads ────────────────────────────────────────────────────────
// One row per lead assigned to a campaign
export const campaignLeads = sqliteTable('campaign_leads', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text('tenant_id').notNull().default('default'),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  variantId: text('variant_id').references(() => campaignVariants.id),
  // Lead identity
  providerId: text('provider_id').notNull(),
  linkedinUrl: text('linkedin_url'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  headline: text('headline'),
  company: text('company'),
  // Lifecycle
  lifecycleStatus: text('lifecycle_status').notNull().default('Queued'),
  // Queued | Connect_Sent | Connected | DM1_Sent | DM2_Sent | Replied |
  // Demo_Booked | Deal_Created | Closed_Won | Closed_Lost | Expired | No_Reply
  // Qualification
  qualificationScore: integer('qualification_score'),
  tags: text('tags', { mode: 'json' }), // string[]
  source: text('source'), // content_engager | profile_visitor | csv | notion | pre_scored
  // Timestamps for sequence tracking (LinkedIn)
  connectSentAt: text('connect_sent_at'),
  connectedAt: text('connected_at'),
  dm1SentAt: text('dm1_sent_at'),
  dm2SentAt: text('dm2_sent_at'),
  repliedAt: text('replied_at'),
  // Email tracking (Instantly)
  email: text('email'),
  instantlyCampaignId: text('instantly_campaign_id'),
  emailSentAt: text('email_sent_at'),
  emailOpenedAt: text('email_opened_at'),
  emailRepliedAt: text('email_replied_at'),
  emailBouncedAt: text('email_bounced_at'),
  emailStatus: text('email_status'), // queued | sent | opened | replied | bounced
  // Notion sync
  notionPageId: text('notion_page_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
})

// ─── Provider Stats ────────────────────────────────────────────────────────
// Provider performance tracking per execution
export const providerStats = sqliteTable('provider_stats', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  providerId: text('provider_id').notNull(),
  metric: text('metric').notNull(), // 'accuracy' | 'latency_ms' | 'cost_per_call' | 'coverage'
  value: real('value').notNull(),
  sampleSize: integer('sample_size').default(1),
  segment: text('segment'),
  measuredAt: text('measured_at').default(sql`(datetime('now'))`),
})

// ─── Provider Preferences ──────────────────────────────────────────────────
// User or auto-derived provider preferences per skill+segment
export const providerPreferences = sqliteTable('provider_preferences', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  skillId: text('skill_id').notNull(),
  segment: text('segment'),
  preferredProvider: text('preferred_provider').notNull(),
  reason: text('reason'),
  source: text('source').notNull().default('auto'), // 'auto' | 'user' | 'intelligence'
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Signal Watches ──────────────────────────────────────────────────────────
// Active monitoring targets — companies/people to watch for intent signals
export const signalWatches = sqliteTable('signal_watches', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  entityType: text('entity_type').notNull(), // 'company' | 'person'
  entityId: text('entity_id').notNull(),     // domain or linkedin URL
  entityName: text('entity_name').notNull(),
  signalTypes: text('signal_types').notNull(), // JSON: SignalType[]
  baseline: text('baseline').notNull().default('{}'), // JSON: last known state
  createdAt: text('created_at').default(sql`(datetime('now'))`),
  lastCheckedAt: text('last_checked_at').default(sql`(datetime('now'))`),
})

// ─── Signals Log ──────────────────────────────────────────────────────────────
// Passive signal collection from user interactions
export const signalsLog = sqliteTable('signals_log', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().default('default'),
  type: text('type').notNull(),
  category: text('category').notNull(),
  data: text('data').notNull(), // JSON
  conversationId: text('conversation_id'),
  resultSetId: text('result_set_id'),
  campaignId: text('campaign_id'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Data Quality Log ──────────────────────────────────────────────────────
// Data quality issues detected by the monitor
export const dataQualityLog = sqliteTable('data_quality_log', {
  id: text('id').primaryKey(),
  resultSetId: text('result_set_id').notNull(),
  rowId: text('row_id'),
  checkType: text('check_type').notNull(),
  severity: text('severity').notNull(),
  details: text('details'), // JSON
  nudge: text('nudge'),
  action: text('action'), // JSON
  resolved: integer('resolved').notNull().default(0),
  resolvedAt: text('resolved_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Relations ───────────────────────────────────────────────────────────────
export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages),
  workflows: many(workflows),
  campaigns: many(campaigns),
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

export const intelligenceRelations = relations(intelligence, () => ({}))

export const reviewQueueRelations = relations(reviewQueue, () => ({}))
export const notificationPreferencesRelations = relations(notificationPreferences, () => ({}))

export const webCacheRelations = relations(webCache, () => ({}))
export const webResearchTasksRelations = relations(webResearchTasks, () => ({}))

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [campaigns.conversationId],
    references: [conversations.id],
  }),
  steps: many(campaignSteps),
  content: many(campaignContent),
  variants: many(campaignVariants),
  leads: many(campaignLeads),
}))

export const campaignStepsRelations = relations(campaignSteps, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignSteps.campaignId],
    references: [campaigns.id],
  }),
}))

export const campaignContentRelations = relations(campaignContent, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignContent.campaignId],
    references: [campaigns.id],
  }),
  step: one(campaignSteps, {
    fields: [campaignContent.stepId],
    references: [campaignSteps.id],
  }),
}))

export const campaignVariantsRelations = relations(campaignVariants, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [campaignVariants.campaignId],
    references: [campaigns.id],
  }),
  leads: many(campaignLeads),
}))

export const campaignLeadsRelations = relations(campaignLeads, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [campaignLeads.campaignId],
    references: [campaigns.id],
  }),
  variant: one(campaignVariants, {
    fields: [campaignLeads.variantId],
    references: [campaignVariants.id],
  }),
}))

// ─── Lead Blocklist ─────────────────────────────────────────────────────────
// Permanent or campaign-scoped lead exclusions
export const leadBlocklist = sqliteTable('lead_blocklist', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text('tenant_id').notNull().default('default'),
  // Identifier — at least one must be set
  providerId: text('provider_id'),
  linkedinUrl: text('linkedin_url'),
  linkedinSlug: text('linkedin_slug'),
  // What was excluded
  name: text('name'),
  headline: text('headline'),
  company: text('company'),
  // Scope: 'permanent' persists across all campaigns, 'campaign' applies to one campaign
  scope: text('scope', { enum: ['permanent', 'campaign'] }).notNull().default('permanent'),
  campaignId: text('campaign_id'), // only set when scope = 'campaign'
  reason: text('reason'), // user's notes on why excluded
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

// ─── Rate Limit Buckets ──────────────────────────────────────────────────────
// Token bucket rate limiter — DB-backed for persistence across runs
export const rateLimitBuckets = sqliteTable('rate_limit_buckets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tenantId: text('tenant_id').notNull().default('default'),
  provider: text('provider').notNull(),      // 'linkedin.connect', 'linkedin.dm', 'instantly.send'
  accountId: text('account_id').notNull(),   // Provider account identifier
  tokensRemaining: integer('tokens_remaining').notNull(),
  maxTokens: integer('max_tokens').notNull(),
  refillAt: text('refill_at').notNull(),     // ISO timestamp for next refill
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
})

export const rateLimitBucketsRelations = relations(rateLimitBuckets, () => ({}))

// ─── Webhooks ──────────────────────────────────────────────────────────────
// Registered webhook URLs that fire on status changes
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  url: text('url').notNull(),
  event: text('event').notNull(), // 'lead.status_changed' | 'campaign.completed' | 'reply.received'
  campaignId: text('campaign_id'), // null = all campaigns
  active: integer('active').default(1),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
})

export const webhooksRelations = relations(webhooks, () => ({}))

export const signalsLogRelations = relations(signalsLog, () => ({}))

export const providerStatsRelations = relations(providerStats, () => ({}))
export const providerPreferencesRelations = relations(providerPreferences, () => ({}))

export const signalWatchesRelations = relations(signalWatches, () => ({}))
export const dataQualityLogRelations = relations(dataQualityLog, () => ({}))
export const leadBlocklistRelations = relations(leadBlocklist, () => ({}))
