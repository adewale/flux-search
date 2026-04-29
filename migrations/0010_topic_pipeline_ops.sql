-- Topic pipeline operations: non-crawler audit runs and
-- corpus-aware distinctiveness for topic scoring.

ALTER TABLE corpus_topics ADD COLUMN distinctiveness REAL DEFAULT 1.0;

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id           TEXT PRIMARY KEY,
  mode         TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  completed_at TEXT,
  status       TEXT NOT NULL DEFAULT 'running',
  notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_mode_started
  ON pipeline_runs(mode, started_at DESC);
