-- Performance indexes

CREATE INDEX IF NOT EXISTS idx_issues_issue_number ON issues(issue_number);
CREATE INDEX IF NOT EXISTS idx_issues_published_at ON issues(published_at);
CREATE INDEX IF NOT EXISTS idx_issues_year ON issues(year);
CREATE INDEX IF NOT EXISTS idx_issues_canonical_url ON issues(canonical_url);
CREATE INDEX IF NOT EXISTS idx_issues_content_hash ON issues(content_hash);
CREATE INDEX IF NOT EXISTS idx_issues_status ON issues(status);
CREATE INDEX IF NOT EXISTS idx_issue_chunks_issue_id ON issue_chunks(issue_id);
CREATE INDEX IF NOT EXISTS idx_crawl_runs_status ON crawl_runs(status);
