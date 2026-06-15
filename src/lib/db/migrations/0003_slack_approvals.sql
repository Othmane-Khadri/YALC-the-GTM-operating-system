CREATE TABLE `slack_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_ts` text NOT NULL,
	`run_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`channel` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_approvals_thread_ts_idx` ON `slack_approvals` (`thread_ts`);--> statement-breakpoint
CREATE INDEX `slack_approvals_run_id_idx` ON `slack_approvals` (`run_id`);--> statement-breakpoint
CREATE INDEX `slack_approvals_state_idx` ON `slack_approvals` (`state`);
