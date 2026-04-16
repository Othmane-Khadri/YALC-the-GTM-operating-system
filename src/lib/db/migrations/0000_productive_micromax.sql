CREATE TABLE `accounts` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `campaign_steps` (
	`id` text PRIMARY KEY NOT NULL,
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
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`title` text NOT NULL,
	`hypothesis` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`target_segment` text,
	`channels` text NOT NULL,
	`success_metrics` text NOT NULL,
	`metrics` text NOT NULL,
	`verdict` text,
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
	`title` text NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`file_name` text NOT NULL,
	`extracted_text` text DEFAULT '' NOT NULL,
	`metadata` text,
	`created_at` integer,
	`updated_at` integer
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
	`provider_id` text NOT NULL,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`sample_size` integer DEFAULT 1,
	`segment` text,
	`measured_at` text DEFAULT (datetime('now'))
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
CREATE TABLE `sessions` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signals_log` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`data` text NOT NULL,
	`conversation_id` text,
	`result_set_id` text,
	`campaign_id` text,
	`created_at` text DEFAULT (datetime('now'))
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`emailVerified` integer,
	`image` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verificationTokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
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
	`target_type` text NOT NULL,
	`target_identifier` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`results` text,
	`requested_by` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`completed_at` text
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
