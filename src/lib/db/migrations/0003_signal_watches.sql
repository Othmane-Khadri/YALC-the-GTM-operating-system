-- Signal watches table for active intent monitoring
CREATE TABLE IF NOT EXISTS `signal_watches` (
  `id` text PRIMARY KEY NOT NULL,
  `tenant_id` text NOT NULL DEFAULT 'default',
  `entity_type` text NOT NULL,
  `entity_id` text NOT NULL,
  `entity_name` text NOT NULL,
  `signal_types` text NOT NULL,
  `baseline` text NOT NULL DEFAULT '{}',
  `created_at` text DEFAULT (datetime('now')),
  `last_checked_at` text DEFAULT (datetime('now'))
);
