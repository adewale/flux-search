-- D1 hot-path indexes and planner stats.
-- Added after auditing topic/detail/search/admin queue access patterns.

ALTER TABLE pipeline_jobs ADD COLUMN next_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_issue_topics_keyword_issue
  ON issue_topics(keyword, issue_id);

CREATE INDEX IF NOT EXISTS idx_issues_status_published
  ON issues(status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_issue_number_status
  ON issues(issue_number, status);

CREATE INDEX IF NOT EXISTS idx_topic_timeline_keyword_date
  ON topic_timeline(keyword, year, month);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status_next_attempt
  ON pipeline_jobs(status, next_attempt_at, queued_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_run_status_queued
  ON pipeline_jobs(run_id, status, queued_at DESC);

CREATE INDEX IF NOT EXISTS idx_topic_similarity_keyword_blended
  ON topic_similarity(keyword_a, blended DESC);

PRAGMA optimize;
