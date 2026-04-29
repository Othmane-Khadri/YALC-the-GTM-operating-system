CREATE TABLE `company_signal_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`provider` text DEFAULT 'predictleads' NOT NULL,
	`domain` text NOT NULL,
	`signal_type` text NOT NULL,
	`last_fetched_at` integer,
	`api_call_count` integer DEFAULT 0 NOT NULL,
	`rows_returned` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text DEFAULT 'default' NOT NULL,
	`provider` text DEFAULT 'predictleads' NOT NULL,
	`domain` text NOT NULL,
	`signal_type` text NOT NULL,
	`signal_id` text,
	`payload` text NOT NULL,
	`event_date` text,
	`first_seen_at` integer,
	`last_seen_at` integer
);
--> statement-breakpoint
CREATE INDEX `company_signals_domain_type_idx` ON `company_signals` (`domain`,`signal_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `company_signals_unique_idx` ON `company_signals` (`provider`,`domain`,`signal_type`,`signal_id`);