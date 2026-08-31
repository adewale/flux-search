-- Recover queue jobs after a worker dies while retaining ownership fencing.

ALTER TABLE pipeline_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE pipeline_jobs ADD COLUMN lease_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_claim_lease
  ON pipeline_jobs(status, lease_expires_at);
