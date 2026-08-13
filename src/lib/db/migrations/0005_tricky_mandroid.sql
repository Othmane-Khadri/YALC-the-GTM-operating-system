-- The parent key must exist before SQLite can validate the new composite FK.
-- Keep foreign key enforcement enabled: a pre-0005 row whose run does not
-- match its conversation fails closed during the copy, leaving the old table
-- intact rather than silently preserving an invalid relationship.
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_conversations_tenant_id_run_idx` ON `outreach_conversations` (`tenant_id`,`id`,`provider_run_id`);--> statement-breakpoint
CREATE TABLE `__new_outreach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`outreach_conversation_id` text NOT NULL,
	`provider_run_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_message_id` text,
	`fingerprint` text NOT NULL,
	`direction` text NOT NULL,
	`message_kind` text NOT NULL,
	`subject` text,
	`body_text` text NOT NULL,
	`provider_timestamp` text NOT NULL,
	`imported_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`tenant_id`,`outreach_conversation_id`,`provider_run_id`) REFERENCES `outreach_conversations`(`tenant_id`,`id`,`provider_run_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`provider_run_id`) REFERENCES `campaign_provider_runs`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outreach_messages_provider_check" CHECK("__new_outreach_messages"."provider" in ('heyreach', 'instantly')),
	CONSTRAINT "outreach_messages_direction_check" CHECK("__new_outreach_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "outreach_messages_kind_check" CHECK("__new_outreach_messages"."message_kind" in ('campaign_automated', 'human', 'auto_reply', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_outreach_messages`("id", "tenant_id", "outreach_conversation_id", "provider_run_id", "provider", "external_message_id", "fingerprint", "direction", "message_kind", "subject", "body_text", "provider_timestamp", "imported_at") SELECT "id", "tenant_id", "outreach_conversation_id", "provider_run_id", "provider", "external_message_id", "fingerprint", "direction", "message_kind", "subject", "body_text", "provider_timestamp", "imported_at" FROM `outreach_messages`;--> statement-breakpoint
DROP TABLE `outreach_messages`;--> statement-breakpoint
ALTER TABLE `__new_outreach_messages` RENAME TO `outreach_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_messages_tenant_run_provider_fingerprint_idx` ON `outreach_messages` (`tenant_id`,`provider_run_id`,`provider`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_messages_tenant_run_provider_external_idx` ON `outreach_messages` (`tenant_id`,`provider_run_id`,`provider`,`external_message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_messages_tenant_conversation_timestamp_idx` ON `outreach_messages` (`tenant_id`,`outreach_conversation_id`,`provider_timestamp`);
