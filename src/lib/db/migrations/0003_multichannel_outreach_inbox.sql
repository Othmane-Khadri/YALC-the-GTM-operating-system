CREATE TABLE `campaign_provider_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_campaign_id` text NOT NULL,
	`external_name` text NOT NULL,
	`external_status` text,
	`sender_account_id` text,
	`sync_cursor` text,
	`sync_watermark` text,
	`first_message_imported_at` text,
	`last_sync_started_at` text,
	`last_sync_succeeded_at` text,
	`last_sync_failed_at` text,
	`last_error_code` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `campaigns`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "campaign_provider_runs_provider_check" CHECK("campaign_provider_runs"."provider" in ('heyreach', 'instantly'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_provider_runs_tenant_id_idx` ON `campaign_provider_runs` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_provider_runs_tenant_provider_external_idx` ON `campaign_provider_runs` (`tenant_id`,`provider`,`external_campaign_id`);--> statement-breakpoint
CREATE INDEX `campaign_provider_runs_tenant_campaign_idx` ON `campaign_provider_runs` (`tenant_id`,`campaign_id`);--> statement-breakpoint
CREATE TABLE `outreach_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_lead_id` text NOT NULL,
	`provider_run_id` text NOT NULL,
	`provider` text NOT NULL,
	`channel` text NOT NULL,
	`external_thread_id` text NOT NULL,
	`provider_unread` integer,
	`provider_intent` text,
	`last_message_at` text,
	`last_inbound_at` text,
	`last_human_outbound_at` text,
	`last_direction` text,
	`last_message_kind` text,
	`first_seen_at` text,
	`last_synced_at` text,
	FOREIGN KEY (`tenant_id`,`campaign_lead_id`) REFERENCES `campaign_leads`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`provider_run_id`) REFERENCES `campaign_provider_runs`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outreach_conversations_provider_check" CHECK("outreach_conversations"."provider" in ('heyreach', 'instantly')),
	CONSTRAINT "outreach_conversations_channel_check" CHECK("outreach_conversations"."channel" in ('linkedin', 'email')),
	CONSTRAINT "outreach_conversations_last_direction_check" CHECK("outreach_conversations"."last_direction" in ('inbound', 'outbound')),
	CONSTRAINT "outreach_conversations_last_message_kind_check" CHECK("outreach_conversations"."last_message_kind" in ('campaign_automated', 'human', 'auto_reply', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_conversations_tenant_id_idx` ON `outreach_conversations` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_conversations_tenant_provider_thread_idx` ON `outreach_conversations` (`tenant_id`,`provider`,`external_thread_id`);--> statement-breakpoint
CREATE INDEX `outreach_conversations_tenant_lead_idx` ON `outreach_conversations` (`tenant_id`,`campaign_lead_id`);--> statement-breakpoint
CREATE TABLE `outreach_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_lead_id` text NOT NULL,
	`outreach_conversation_id` text,
	`target_channel` text NOT NULL,
	`body_text` text NOT NULL,
	`origin` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`tenant_id`,`campaign_lead_id`) REFERENCES `campaign_leads`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`outreach_conversation_id`) REFERENCES `outreach_conversations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outreach_drafts_channel_check" CHECK("outreach_drafts"."target_channel" in ('linkedin', 'email')),
	CONSTRAINT "outreach_drafts_origin_check" CHECK("outreach_drafts"."origin" in ('codex', 'manual')),
	CONSTRAINT "outreach_drafts_status_check" CHECK("outreach_drafts"."status" in ('draft', 'copied', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE `outreach_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`campaign_lead_id` text NOT NULL,
	`provider` text NOT NULL,
	`identity_type` text NOT NULL,
	`external_identity_id` text,
	`normalized_value` text NOT NULL,
	`evidence_type` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `campaigns`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`campaign_lead_id`) REFERENCES `campaign_leads`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "outreach_identities_provider_check" CHECK("outreach_identities"."provider" in ('heyreach', 'instantly')),
	CONSTRAINT "outreach_identities_identity_type_check" CHECK("outreach_identities"."identity_type" in ('provider_id', 'email', 'linkedin_url')),
	CONSTRAINT "outreach_identities_evidence_type_check" CHECK("outreach_identities"."evidence_type" in ('provider_payload', 'existing_record', 'manual_link'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_identities_tenant_id_idx` ON `outreach_identities` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_identities_tenant_campaign_provider_type_value_idx` ON `outreach_identities` (`tenant_id`,`campaign_id`,`provider`,`identity_type`,`normalized_value`);--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_identities_tenant_campaign_provider_external_idx` ON `outreach_identities` (`tenant_id`,`campaign_id`,`provider`,`external_identity_id`);--> statement-breakpoint
CREATE INDEX `outreach_identities_tenant_lead_idx` ON `outreach_identities` (`tenant_id`,`campaign_lead_id`);--> statement-breakpoint
CREATE TABLE `outreach_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`outreach_conversation_id` text NOT NULL,
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
	CONSTRAINT "outreach_messages_provider_check" CHECK("outreach_messages"."provider" in ('heyreach', 'instantly')),
	CONSTRAINT "outreach_messages_direction_check" CHECK("outreach_messages"."direction" in ('inbound', 'outbound')),
	CONSTRAINT "outreach_messages_kind_check" CHECK("outreach_messages"."message_kind" in ('campaign_automated', 'human', 'auto_reply', 'unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_messages_tenant_provider_fingerprint_idx` ON `outreach_messages` (`tenant_id`,`provider`,`fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `outreach_messages_tenant_provider_external_idx` ON `outreach_messages` (`tenant_id`,`provider`,`external_message_id`);--> statement-breakpoint
CREATE INDEX `outreach_messages_tenant_conversation_timestamp_idx` ON `outreach_messages` (`tenant_id`,`outreach_conversation_id`,`provider_timestamp`);--> statement-breakpoint
CREATE TABLE `outreach_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`campaign_id` text,
	`requested_providers` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`provider_summary` text DEFAULT '{}' NOT NULL,
	`pages_processed` integer DEFAULT 0 NOT NULL,
	`conversations_processed` integer DEFAULT 0 NOT NULL,
	`messages_processed` integer DEFAULT 0 NOT NULL,
	`malformed_messages` integer DEFAULT 0 NOT NULL,
	`identity_conflicts` integer DEFAULT 0 NOT NULL,
	`started_at` text,
	`finished_at` text,
	`created_at` text DEFAULT (datetime('now')),
	`updated_at` text DEFAULT (datetime('now')),
	FOREIGN KEY (`tenant_id`,`campaign_id`) REFERENCES `campaigns`(`tenant_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outreach_sync_runs_status_check" CHECK("outreach_sync_runs"."status" in ('queued', 'running', 'partial', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `outreach_sync_runs_tenant_status_idx` ON `outreach_sync_runs` (`tenant_id`,`status`);--> statement-breakpoint
CREATE INDEX `outreach_sync_runs_tenant_campaign_idx` ON `outreach_sync_runs` (`tenant_id`,`campaign_id`);--> statement-breakpoint
ALTER TABLE `campaign_leads` ADD `inbox_state` text;--> statement-breakpoint
ALTER TABLE `campaign_leads` ADD `snoozed_until` text;--> statement-breakpoint
ALTER TABLE `campaign_leads` ADD `inbox_state_updated_at` text;--> statement-breakpoint
CREATE TRIGGER `campaign_leads_inbox_state_insert_check`
BEFORE INSERT ON `campaign_leads`
WHEN NEW.`inbox_state` IS NOT NULL AND NEW.`inbox_state` NOT IN ('pending', 'resolved', 'snoozed')
BEGIN
  SELECT RAISE(ABORT, 'invalid campaign_leads.inbox_state');
END;--> statement-breakpoint
CREATE TRIGGER `campaign_leads_inbox_state_update_check`
BEFORE UPDATE OF `inbox_state` ON `campaign_leads`
WHEN NEW.`inbox_state` IS NOT NULL AND NEW.`inbox_state` NOT IN ('pending', 'resolved', 'snoozed')
BEGIN
  SELECT RAISE(ABORT, 'invalid campaign_leads.inbox_state');
END;--> statement-breakpoint
-- Composite tenant FKs keep cross-tenant references invalid. These narrowly
-- scoped triggers preserve optional-reference SET NULL behavior without nulling
-- the mandatory tenant_id column of a composite relationship.
CREATE TRIGGER `outreach_drafts_clear_deleted_conversation`
BEFORE DELETE ON `outreach_conversations`
BEGIN
  UPDATE `outreach_drafts`
  SET `outreach_conversation_id` = NULL
  WHERE `tenant_id` = OLD.`tenant_id`
    AND `outreach_conversation_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE TRIGGER `outreach_sync_runs_clear_deleted_campaign`
BEFORE DELETE ON `campaigns`
BEGIN
  UPDATE `outreach_sync_runs`
  SET `campaign_id` = NULL
  WHERE `tenant_id` = OLD.`tenant_id`
    AND `campaign_id` = OLD.`id`;
END;--> statement-breakpoint
CREATE UNIQUE INDEX `campaign_leads_tenant_id_idx` ON `campaign_leads` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `campaigns_tenant_id_idx` ON `campaigns` (`tenant_id`,`id`);
