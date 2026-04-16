-- Phase 1 / A1 — multi-tenancy: add tenant_id to 15 operational tables.
-- Hand-written because drizzle-kit generate is interactive on rename ambiguity
-- with the legacy auth-baseline snapshot. Idempotent guard is per-statement
-- (sqlite ALTER will error if column exists; run once on a fresh DB).

ALTER TABLE frameworks            ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE intelligence          ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE knowledge_items       ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE review_queue          ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE web_research_tasks    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE campaigns             ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE campaign_steps        ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE campaign_content      ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE campaign_variants     ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE campaign_leads        ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE provider_stats        ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE provider_preferences  ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE signals_log           ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE lead_blocklist        ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';--> statement-breakpoint
ALTER TABLE rate_limit_buckets    ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
