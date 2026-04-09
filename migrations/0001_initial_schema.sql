-- Core tables for Flux Search

CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  issue_number INTEGER,
  title TEXT NOT NULL,
  subtitle TEXT,
  published_at TEXT,
  source_url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  authors TEXT,
  contributors TEXT,
  summary TEXT,
  full_text_markdown TEXT,
  full_text_plain TEXT,
  crawl_run_id TEXT,
  content_hash TEXT,
  ingested_at TEXT NOT NULL,
  word_count INTEGER,
  status TEXT DEFAULT 'active',
  year INTEGER,
  month INTEGER,
  has_semantic_chunks INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS issue_chunks (
  id TEXT PRIMARY KEY,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  section_label TEXT,
  chunk_text TEXT NOT NULL,
  token_estimate INTEGER,
  content_hash TEXT
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id TEXT PRIMARY KEY,
  seed_url TEXT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  records_found INTEGER DEFAULT 0,
  issues_created INTEGER DEFAULT 0,
  issues_updated INTEGER DEFAULT 0,
  issues_skipped INTEGER DEFAULT 0,
  notes TEXT
);
