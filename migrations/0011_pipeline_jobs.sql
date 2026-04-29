-- Durable queue job state for Flux enrichment pipeline.

CREATE TABLE IF NOT EXISTS pipeline_jobs (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,
  kind           TEXT NOT NULL,
  semantic_key   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  payload_json   TEXT NOT NULL,
  attempts       INTEGER NOT NULL DEFAULT 0,
  correlation_id TEXT NOT NULL,
  queued_at      TEXT NOT NULL,
  started_at     TEXT,
  completed_at   TEXT,
  error          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_jobs_active_semantic_key
  ON pipeline_jobs(semantic_key)
  WHERE status IN ('queued', 'processing', 'deferred');

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_run_status
  ON pipeline_jobs(run_id, status, queued_at DESC);

CREATE TABLE IF NOT EXISTS pipeline_phases (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES pipeline_jobs(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'running',
  elapsed_ms   INTEGER,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_phases_job_started
  ON pipeline_phases(job_id, started_at DESC);
