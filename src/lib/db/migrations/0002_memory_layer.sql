-- Phase 1 / B1 — memory layer: 6 tables for hybrid vector+graph+episodic memory.
-- Hand-written for the same reason as 0001 (drizzle-kit generate is interactive
-- against the legacy auth-baseline snapshot).

CREATE TABLE IF NOT EXISTS memory_index (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL,
  node_ids      TEXT NOT NULL,
  category      TEXT NOT NULL,
  priority      INTEGER NOT NULL DEFAULT 50,
  last_updated  TEXT DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_index_tenant_idx ON memory_index(tenant_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS memory_nodes (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL,
  type               TEXT NOT NULL,
  content            TEXT NOT NULL,
  entities           TEXT,
  source_type        TEXT NOT NULL,
  source_ref         TEXT NOT NULL,
  source_hash        TEXT NOT NULL,
  confidence         TEXT NOT NULL DEFAULT 'hypothesis',
  confidence_score   INTEGER NOT NULL DEFAULT 0,
  metadata           TEXT,
  created_at         TEXT DEFAULT (datetime('now')),
  last_accessed_at   TEXT DEFAULT (datetime('now')),
  access_count       INTEGER NOT NULL DEFAULT 0,
  validated_at       TEXT,
  supersedes         TEXT,
  archived_at        TEXT
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_nodes_tenant_idx              ON memory_nodes(tenant_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_nodes_tenant_type_idx         ON memory_nodes(tenant_id, type);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_nodes_tenant_source_hash_idx  ON memory_nodes(tenant_id, source_hash);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_nodes_tenant_confidence_idx   ON memory_nodes(tenant_id, confidence);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS memory_embeddings (
  node_id     TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  embedding   BLOB NOT NULL,
  model       TEXT NOT NULL,
  dims        INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_embeddings_tenant_idx ON memory_embeddings(tenant_id);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS entities (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  aliases     TEXT,
  properties  TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entities_tenant_idx            ON entities(tenant_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entities_tenant_type_name_idx  ON entities(tenant_id, type, name);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS memory_edges (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL,
  from_type   TEXT NOT NULL,
  from_id     TEXT NOT NULL,
  to_type     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  relation    TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_edges_tenant_idx          ON memory_edges(tenant_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_edges_tenant_from_idx     ON memory_edges(tenant_id, from_type, from_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_edges_tenant_to_idx       ON memory_edges(tenant_id, to_type, to_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_edges_tenant_relation_idx ON memory_edges(tenant_id, relation);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS memory_episodes (
  id                     TEXT PRIMARY KEY,
  tenant_id              TEXT NOT NULL,
  kind                   TEXT NOT NULL,
  payload                TEXT NOT NULL,
  summarized_to_node_id  TEXT,
  created_at             TEXT DEFAULT (datetime('now')),
  archived_at            TEXT
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_episodes_tenant_idx       ON memory_episodes(tenant_id);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS memory_episodes_tenant_kind_idx  ON memory_episodes(tenant_id, kind);
