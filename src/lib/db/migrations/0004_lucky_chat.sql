-- campaign_provider_runs are tenant-and-canonical-campaign scoped. Keep an
-- identical provider thread independent when it occurs in another run.
DROP INDEX IF EXISTS `outreach_conversations_tenant_provider_thread_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_conversations_tenant_run_provider_thread_idx` ON `outreach_conversations` (`tenant_id`,`provider_run_id`,`provider`,`external_thread_id`);--> statement-breakpoint
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
	FOREIGN KEY (`tenant_id`,`outreach_conversation_id`) REFERENCES `outreach_conversations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`provider_run_id`) REFERENCES `campaign_provider_runs`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outreach_messages_provider_check" CHECK("__new_outreach_messages"."provider" in ('heyreach', 'instantly')),
	CONSTRAINT "outreach_messages_direction_check" CHECK("__new_outreach_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "outreach_messages_kind_check" CHECK("__new_outreach_messages"."message_kind" in ('campaign_automated', 'human', 'auto_reply', 'unknown'))
);
--> statement-breakpoint
-- 0003 rows have no provider_run_id. It is recoverable through their mandatory
-- tenant-scoped conversation relationship, so this upgrade neither drops nor
-- coalesces historical messages.
INSERT INTO `__new_outreach_messages`("id", "tenant_id", "outreach_conversation_id", "provider_run_id", "provider", "external_message_id", "fingerprint", "direction", "message_kind", "subject", "body_text", "provider_timestamp", "imported_at")
SELECT message."id", message."tenant_id", message."outreach_conversation_id", conversation."provider_run_id", message."provider", message."external_message_id", message."fingerprint", message."direction", message."message_kind", message."subject", message."body_text", message."provider_timestamp", message."imported_at"
FROM `outreach_messages` AS message
INNER JOIN `outreach_conversations` AS conversation
  ON conversation."tenant_id" = message."tenant_id"
  AND conversation."id" = message."outreach_conversation_id";--> statement-breakpoint
DROP TABLE `outreach_messages`;--> statement-breakpoint
ALTER TABLE `__new_outreach_messages` RENAME TO `outreach_messages`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_messages_tenant_run_provider_fingerprint_idx` ON `outreach_messages` (`tenant_id`,`provider_run_id`,`provider`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `outreach_messages_tenant_run_provider_external_idx` ON `outreach_messages` (`tenant_id`,`provider_run_id`,`provider`,`external_message_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `outreach_messages_tenant_conversation_timestamp_idx` ON `outreach_messages` (`tenant_id`,`outreach_conversation_id`,`provider_timestamp`);
