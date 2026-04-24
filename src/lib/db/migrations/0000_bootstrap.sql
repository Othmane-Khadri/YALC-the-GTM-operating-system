CREATE TABLE `api_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_tested_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_connections_provider_unique` ON `api_connections` (`provider`);--> statement-breakpoint
CREATE TABLE `campaign_content` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`campaign_id` text NOT NULL,
	`step_id` text NOT NULL,
	`content_type` text NOT NULL,
	`target_lead_id` text,
	`content` text NOT NULL,
	`variant` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`personalization_data` text NOT NULL,
	`sent_at` text,
	`opened_at` text,
	`clicked_at` text,
	`replied_at` text,
	`converted_at` text,
	`bounced_at` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `campaign_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaign_leads` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`campaign_id` text NOT NULL,
	`variant_id` text,
	`provider_id` text NOT NULL,
	`linkedin_url` text,
	`first_name` text,
	`last_name` text,
	`headline` text,
	`company` text,
	`lifecycle_status` text DEFAULT 'Queued' NOT NULL,
	`qualification_score` integer,
	`tags` text,
	`source` text,
	`connect_sent_at` text,
	`connected_at` text,
	`dm1_sent_at` text,
	`dm2_sent_at` text,
	`replied_at` text,
	`email` text,
	`instantly_campaign_id` text,
	`email_sent_at` text,
	`email_opened_at` text,
	`email_replied_at` text,
	`email_bounced_at` text,
	`email_status` text,
	`notion_page_id` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `campaign_variants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `campaign_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`campaign_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`skill_id` text NOT NULL,
	`skill_input` text NOT NULL,
	`channel` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`depends_on` text DEFAULT '[]' NOT NULL,
	`approval_required` integer DEFAULT 1 NOT NULL,
	`result_set_id` text,
	`scheduled_at` text,
	`completed_at` text,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaign_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`campaign_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`connect_note` text NOT NULL,
	`dm1_template` text NOT NULL,
	`dm2_template` text NOT NULL,
	`sends` integer DEFAULT 0,
	`accepts` integer DEFAULT 0,
	`accept_rate` real DEFAULT 0,
	`dms_sent` integer DEFAULT 0,
	`replies` integer DEFAULT 0,
	`reply_rate` real DEFAULT 0,
	`notion_page_id` text,
	`created_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`conversation_id` text NOT NULL,
	`title` text NOT NULL,
	`hypothesis` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`target_segment` text,
	`channels` text NOT NULL,
	`success_metrics` text NOT NULL,
	`metrics` text NOT NULL,
	`verdict` text,
	`linkedin_account_id` text,
	`daily_limit` integer DEFAULT 30,
	`sequence_timing` text,
	`experiment_status` text,
	`winner_variant` text,
	`notion_page_id` text,
	`schedule` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New Conversation' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `data_quality_log` (
	`id` text PRIMARY KEY NOT NULL,
	`result_set_id` text NOT NULL,
	`row_id` text,
	`check_type` text NOT NULL,
	`severity` text NOT NULL,
	`details` text,
	`nudge` text,
	`action` text,
	`resolved` integer DEFAULT 0 NOT NULL,
	`resolved_at` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `frameworks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`data` text NOT NULL,
	`onboarding_step` integer DEFAULT 0,
	`onboarding_complete` integer DEFAULT false,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `intelligence` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`category` text NOT NULL,
	`insight` text NOT NULL,
	`evidence` text NOT NULL,
	`segment` text,
	`channel` text,
	`confidence` text DEFAULT 'hypothesis' NOT NULL,
	`confidence_score` integer DEFAULT 0,
	`source` text NOT NULL,
	`bias_check` text,
	`supersedes` text,
	`created_at` text DEFAULT (datetime('now')),
	`validated_at` text,
	`expires_at` text
);
--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`file_name` text NOT NULL,
	`extracted_text` text DEFAULT '' NOT NULL,
	`metadata` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `lead_blocklist` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`provider_id` text,
	`linkedin_url` text,
	`linkedin_slug` text,
	`name` text,
	`headline` text,
	`company` text,
	`scope` text DEFAULT 'permanent' NOT NULL,
	`campaign_id` text,
	`reason` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`command` text,
	`args` text,
	`url` text,
	`env` text,
	`status` text DEFAULT 'disconnected',
	`last_connected_at` text,
	`discovered_tools` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`message_type` text DEFAULT 'text' NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`config` text NOT NULL,
	`min_priority` text DEFAULT 'normal' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`skill_id` text NOT NULL,
	`segment` text,
	`preferred_provider` text NOT NULL,
	`reason` text,
	`source` text DEFAULT 'auto' NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `provider_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`provider_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`sample_size` integer DEFAULT 1,
	`segment` text,
	`measured_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `rate_limit_buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`tokens_remaining` integer NOT NULL,
	`max_tokens` integer NOT NULL,
	`refill_at` text NOT NULL,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `result_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`result_set_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`data` text NOT NULL,
	`feedback` text,
	`tags` text,
	`annotation` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`result_set_id`) REFERENCES `result_sets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `result_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`name` text NOT NULL,
	`columns_definition` text,
	`row_count` integer DEFAULT 0,
	`created_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `review_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`source_system` text NOT NULL,
	`source_id` text NOT NULL,
	`priority` text DEFAULT 'normal' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`action` text,
	`nudge_evidence` text,
	`reviewed_at` text,
	`review_notes` text,
	`expires_at` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `signal_watches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`signal_types` text NOT NULL,
	`baseline` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`last_checked_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `signals_log` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`data` text NOT NULL,
	`conversation_id` text,
	`result_set_id` text,
	`campaign_id` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `web_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`content` text NOT NULL,
	`content_type` text NOT NULL,
	`extracted_insights` text,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_cache_url_unique` ON `web_cache` (`url`);--> statement-breakpoint
CREATE TABLE `web_research_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`target_type` text NOT NULL,
	`target_identifier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`results` text,
	`requested_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`event` text NOT NULL,
	`campaign_id` text,
	`active` integer DEFAULT 1,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`step_type` text NOT NULL,
	`provider` text NOT NULL,
	`config` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`result` text,
	`rows_in` integer DEFAULT 0,
	`rows_out` integer DEFAULT 0,
	`cost_estimate` real,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`steps_definition` text,
	`result_count` integer DEFAULT 0,
	`created_at` integer,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`aliases` text,
	`properties` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `entities_tenant_idx` ON `entities` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `entities_tenant_type_name_idx` ON `entities` (`tenant_id`,`type`,`name`);--> statement-breakpoint
CREATE TABLE `memory_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_type` text NOT NULL,
	`from_id` text NOT NULL,
	`to_type` text NOT NULL,
	`to_id` text NOT NULL,
	`relation` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `memory_edges_tenant_idx` ON `memory_edges` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_edges_tenant_from_idx` ON `memory_edges` (`tenant_id`,`from_type`,`from_id`);--> statement-breakpoint
CREATE INDEX `memory_edges_tenant_to_idx` ON `memory_edges` (`tenant_id`,`to_type`,`to_id`);--> statement-breakpoint
CREATE INDEX `memory_edges_tenant_relation_idx` ON `memory_edges` (`tenant_id`,`relation`);--> statement-breakpoint
CREATE TABLE `memory_embeddings` (
	`node_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`embedding` blob NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `memory_embeddings_tenant_idx` ON `memory_embeddings` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `memory_episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`summarized_to_node_id` text,
	`created_at` text DEFAULT (datetime('now')),
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `memory_episodes_tenant_idx` ON `memory_episodes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_episodes_tenant_kind_idx` ON `memory_episodes` (`tenant_id`,`kind`);--> statement-breakpoint
CREATE TABLE `memory_index` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`node_ids` text NOT NULL,
	`category` text NOT NULL,
	`priority` integer DEFAULT 50 NOT NULL,
	`last_updated` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE INDEX `memory_index_tenant_idx` ON `memory_index` (`tenant_id`);--> statement-breakpoint
CREATE TABLE `memory_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`entities` text,
	`source_type` text NOT NULL,
	`source_ref` text NOT NULL,
	`source_hash` text NOT NULL,
	`confidence` text DEFAULT 'hypothesis' NOT NULL,
	`confidence_score` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`created_at` text DEFAULT (datetime('now')),
	`last_accessed_at` text DEFAULT (datetime('now')),
	`access_count` integer DEFAULT 0 NOT NULL,
	`validated_at` text,
	`supersedes` text,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `memory_nodes_tenant_idx` ON `memory_nodes` (`tenant_id`);--> statement-breakpoint
CREATE INDEX `memory_nodes_tenant_type_idx` ON `memory_nodes` (`tenant_id`,`type`);--> statement-breakpoint
CREATE INDEX `memory_nodes_tenant_source_hash_idx` ON `memory_nodes` (`tenant_id`,`source_hash`);--> statement-breakpoint
CREATE INDEX `memory_nodes_tenant_confidence_idx` ON `memory_nodes` (`tenant_id`,`confidence`);