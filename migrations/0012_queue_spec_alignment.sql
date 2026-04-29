-- Align durable enrichment queue tables with specs/flux-queues.spec.md.

ALTER TABLE pipeline_jobs ADD COLUMN schema_version INTEGER DEFAULT 1;
ALTER TABLE pipeline_jobs ADD COLUMN attempt_count INTEGER DEFAULT 0;
ALTER TABLE pipeline_jobs ADD COLUMN result_json TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN last_error TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN last_error_kind TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN last_error_stage TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN rate_limited_until TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN finished_at TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN updated_at TEXT;

ALTER TABLE pipeline_phases ADD COLUMN run_id TEXT;
ALTER TABLE pipeline_phases ADD COLUMN phase TEXT;
ALTER TABLE pipeline_phases ADD COLUMN finished_at TEXT;
ALTER TABLE pipeline_phases ADD COLUMN error_count INTEGER DEFAULT 0;
ALTER TABLE pipeline_phases ADD COLUMN summary_json TEXT;

CREATE TABLE IF NOT EXISTS topic_embeddings (
  keyword    TEXT PRIMARY KEY REFERENCES corpus_topics(keyword) ON DELETE CASCADE,
  model      TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_topic_embeddings_updated
  ON topic_embeddings(updated_at DESC);
